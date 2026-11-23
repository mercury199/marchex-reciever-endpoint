import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { BarChart, LineChart, SplitBar, StatTile } from "../components/charts.js";

function formatSeconds(value: number | null): string {
  if (value === null) return "-";
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function formatDateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const [market, setMarket] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [channel, setChannel] = useState("");
  const [paid, setPaid] = useState<"" | "true" | "false">("");
  const [registeredDnc, setRegisteredDnc] = useState<"" | "true" | "false">("");

  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());
    if (channel) params.set("channel", channel);
    if (paid) params.set("paid", paid);
    if (registeredDnc) params.set("registeredDnc", registeredDnc);
    return params;
  }

  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", market, dateFrom, dateTo, channel, paid, registeredDnc],
    queryFn: () => api.dashboardStats(buildParams()),
  });

  const stats = statsQuery.data;
  const answeredRow = stats?.answerStatus.find((a) => a.status === "answered");
  const answeredCount = answeredRow?.count ?? 0;
  const totalWithAnswerStatus = stats?.answerStatus.reduce((sum, a) => sum + a.count, 0) ?? 0;
  const notAnsweredCount = totalWithAnswerStatus - answeredCount;
  const paidCount = stats?.paidBreakdown.find((p) => p.paid)?.count ?? 0;
  const organicCount = stats?.paidBreakdown.find((p) => !p.paid)?.count ?? 0;
  const dncCount = stats?.dncBreakdown.find((d) => d.registeredDnc)?.count ?? 0;
  const notDncCount = stats?.dncBreakdown.find((d) => !d.registeredDnc)?.count ?? 0;

  return (
    <div>
      <div className="toolbar">
        <div className="field">
          <label>Market</label>
          <select value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="">All markets</option>
            {marketsQuery.data?.markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Channel</label>
          <input
            type="text"
            placeholder="e.g. Paid Search, google"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Paid</label>
          <select value={paid} onChange={(e) => setPaid(e.target.value as "" | "true" | "false")}>
            <option value="">Any</option>
            <option value="true">Paid only</option>
            <option value="false">Organic only</option>
          </select>
        </div>
        <div className="field">
          <label>DNC</label>
          <select value={registeredDnc} onChange={(e) => setRegisteredDnc(e.target.value as "" | "true" | "false")}>
            <option value="">Any</option>
            <option value="true">Registered DNC only</option>
            <option value="false">Not DNC only</option>
          </select>
        </div>
      </div>

      {statsQuery.isLoading && <p>Loading...</p>}
      {statsQuery.isError && <p className="error-text">Failed to load dashboard stats.</p>}

      {stats && (
        <>
          <div className="flex-row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <StatTile label="Total events" value={String(stats.totalEvents)} />
            <StatTile label="Calls" value={String(stats.totalCalls)} />
            <StatTile label="Website clicks" value={String(stats.totalClicks)} />
            <StatTile
              label="Linking rate"
              value={stats.linking.percentage !== null ? `${stats.linking.percentage.toFixed(1)}%` : "-"}
              sub={`${stats.linking.linked} of ${stats.linking.total} linkable events`}
            />
            <StatTile label="Avg call length" value={formatSeconds(stats.callLength.avgSeconds)} sub={`${stats.callLength.count} calls with a duration`} />
            <StatTile label="Longest call" value={formatSeconds(stats.callLength.maxSeconds)} />
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Calls over time</h3>
            <LineChart data={stats.byDay.map((d) => ({ label: formatDateLabel(d.date), value: d.count }))} />
          </div>

          <div className="flex-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3 style={{ marginTop: 0 }}>Calls by hour of day (UTC)</h3>
              <BarChart
                data={stats.byHour.map((count, hour) => ({ label: String(hour), value: count }))}
                formatLabel={(label) => formatHour(Number(label))}
              />
            </div>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3 style={{ marginTop: 0 }}>Volume by market</h3>
              <BarChart data={stats.byMarket.map((m) => ({ label: m.market, value: m.count }))} />
            </div>
          </div>

          <div className="flex-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3 style={{ marginTop: 0 }}>Volume by action type</h3>
              <BarChart
                data={stats.byAction.map((a) => ({ label: a.action, value: a.count }))}
                formatLabel={(label) => label.split(".").pop() ?? label}
                height={180}
              />
            </div>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3 style={{ marginTop: 0 }}>Volume by channel</h3>
              <BarChart data={stats.byChannel.map((c) => ({ label: c.channel, value: c.count }))} height={180} />
            </div>
          </div>

          <div className="flex-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <h3 style={{ marginTop: 0 }}>Answered vs. not</h3>
              <SplitBar left={{ label: "Answered", value: answeredCount }} right={{ label: "Not answered", value: notAnsweredCount }} />
            </div>
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <h3 style={{ marginTop: 0 }}>Paid vs. organic</h3>
              <SplitBar left={{ label: "Paid", value: paidCount }} right={{ label: "Organic", value: organicCount }} />
            </div>
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <h3 style={{ marginTop: 0 }}>Registered DNC</h3>
              <SplitBar left={{ label: "DNC", value: dncCount }} right={{ label: "Not DNC", value: notDncCount }} leftColor="#dc2626" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
