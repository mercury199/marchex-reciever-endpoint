import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export default function RawDeliveriesPage() {
  const queryClient = useQueryClient();
  const [hasErrorOnly, setHasErrorOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const params = new URLSearchParams();
  if (hasErrorOnly) params.set("hasError", "true");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const deliveriesQuery = useQuery({
    queryKey: ["raw-deliveries", hasErrorOnly, page],
    queryFn: () => api.rawDeliveries(params),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: string) => api.reprocessRawDelivery(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["raw-deliveries"] }),
  });

  const total = deliveriesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="toolbar">
        <label>
          <input
            type="checkbox"
            checked={hasErrorOnly}
            onChange={(e) => {
              setHasErrorOnly(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Show only deliveries with parse errors
        </label>
      </div>

      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>Request ID</th>
            <th>Attempt</th>
            <th>Parse error</th>
            <th>Processing error</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {deliveriesQuery.data?.rows.map((d) => (
            <tr key={d._id}>
              <td>{new Date(d.received_at).toLocaleString()}</td>
              <td>{d.request_id ?? "-"}</td>
              <td>{d.attempt ?? "-"}</td>
              <td>{d.parse_error ? <span className="badge error">{d.parse_error}</span> : ""}</td>
              <td>{d.processing_error ? <span className="badge error">{d.processing_error}</span> : ""}</td>
              <td>
                <button onClick={() => reprocessMutation.mutate(d._id)} disabled={reprocessMutation.isPending}>
                  Reprocess
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {totalPages} ({total} rows)
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
