import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Tab } from "../App.js";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "calls", label: "Calls" },
  { id: "numbers", label: "Numbers" },
  { id: "website-events", label: "Website Events" },
  { id: "attribution", label: "Attribution" },
  { id: "forwarding", label: "Forwarding" },
  { id: "raw-deliveries", label: "Raw Deliveries" },
];

export default function Layout({
  activeTab,
  onTabChange,
  onLogout,
  children,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15_000,
  });

  const healthy = healthQuery.data?.status === "ok";

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>Marchex Call Dashboard</h1>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={activeTab === t.id ? "active" : ""} onClick={() => onTabChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className={`health-badge ${healthy ? "ok" : "degraded"}`} title="Backend / Mongo health">
          {healthQuery.isLoading ? "checking..." : healthy ? "Mongo OK" : "Mongo unreachable"}
        </span>
        <button className="secondary" onClick={onLogout}>
          Log out
        </button>
      </div>
      <div className="content">{children}</div>
    </div>
  );
}
