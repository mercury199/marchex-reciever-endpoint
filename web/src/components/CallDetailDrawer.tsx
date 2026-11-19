import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export default function CallDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["call", id], queryFn: () => api.callDetail(id) });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="flex-row" style={{ justifyContent: "space-between" }}>
          <h2>Call detail</h2>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {isLoading && <p>Loading...</p>}
        {data && (
          <>
            <h3>Event</h3>
            <pre>{JSON.stringify(data.event, null, 2)}</pre>
            <h3>Linked counterpart</h3>
            {data.linked ? <pre>{JSON.stringify(data.linked, null, 2)}</pre> : <p>No linked start/processed event.</p>}
          </>
        )}
      </div>
    </div>
  );
}
