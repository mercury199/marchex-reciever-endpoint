import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export default function ForwardingPage() {
  const queryClient = useQueryClient();
  const targetsQuery = useQuery({ queryKey: ["forward-targets"], queryFn: api.forwardTargets });
  const jobsQuery = useQuery({ queryKey: ["forward-jobs"], queryFn: () => api.forwardJobs() });

  const [newUrl, setNewUrl] = useState("");
  const [newActionFilter, setNewActionFilter] = useState("");
  const [newMarketFilter, setNewMarketFilter] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      api.createForwardTarget({
        url: newUrl,
        action_filter: newActionFilter || null,
        market_filter: newMarketFilter || null,
      }),
    onSuccess: () => {
      setNewUrl("");
      setNewActionFilter("");
      setNewMarketFilter("");
      queryClient.invalidateQueries({ queryKey: ["forward-targets"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateForwardTarget(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["forward-targets"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteForwardTarget(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["forward-targets"] }),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.retryForwardJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["forward-jobs"] }),
  });

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Forward targets</h3>
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Enabled</th>
              <th>Action filter</th>
              <th>Market filter</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {targetsQuery.data?.targets.map((t) => (
              <tr key={t._id}>
                <td>{t.url}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => toggleMutation.mutate({ id: t._id, enabled: e.target.checked })}
                  />
                </td>
                <td>{t.action_filter ?? "(any)"}</td>
                <td>{t.market_filter ?? "(any)"}</td>
                <td>
                  <button className="danger" onClick={() => deleteMutation.mutate(t._id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>Add target</h4>
        <div className="flex-row">
          <input placeholder="https://example.com/hook" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
          <input placeholder="action filter (optional)" value={newActionFilter} onChange={(e) => setNewActionFilter(e.target.value)} />
          <input placeholder="market filter (optional)" value={newMarketFilter} onChange={(e) => setNewMarketFilter(e.target.value)} />
          <button disabled={!newUrl || createMutation.isPending} onClick={() => createMutation.mutate()}>
            Add
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent forward attempts</h3>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Attempts</th>
              <th>Last status</th>
              <th>Latency (ms)</th>
              <th>Last error</th>
              <th>Last attempt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobsQuery.data?.jobs.map((job) => (
              <tr key={job._id}>
                <td>
                  <span className={`badge ${job.status === "failed" ? "error" : ""}`}>{job.status}</span>
                </td>
                <td>{job.attempts}</td>
                <td>{job.last_status_code ?? "-"}</td>
                <td>{job.last_latency_ms ?? "-"}</td>
                <td>{job.last_error ?? ""}</td>
                <td>{job.last_attempt_at ? new Date(job.last_attempt_at).toLocaleString() : "-"}</td>
                <td>
                  {job.status === "failed" && (
                    <button onClick={() => retryMutation.mutate(job._id)}>Retry</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
