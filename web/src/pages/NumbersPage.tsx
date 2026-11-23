import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { BarChart } from "../components/charts.js";

function formatSeconds(value: number | null): string {
  if (value === null) return "";
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export default function NumbersPage() {
  const [market, setMarket] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedNumber, setExpandedNumber] = useState<string | null>(null);

  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());
    return params;
  }

  const numbersQuery = useQuery({
    queryKey: ["number-breakdown", market, dateFrom, dateTo],
    queryFn: () => api.numberBreakdown(buildParams()),
  });

  const rows = numbersQuery.data?.rows ?? [];
  const totalCalls = rows.reduce((sum, r) => sum + r.totalCalls, 0);

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
      </div>

      {numbersQuery.isLoading && <p>Loading...</p>}
      {numbersQuery.isError && <p className="error-text">Failed to load number breakdown.</p>}

      {numbersQuery.data && (
        <>
          <p>
            {rows.length} target number{rows.length === 1 ? "" : "s"}, {totalCalls} total calls.
          </p>
          <table>
            <thead>
              <tr>
                <th>Tracking number</th>
                <th>Market</th>
                <th>Name</th>
                <th>Calls</th>
                <th>Answered</th>
                <th>Avg length</th>
                <th>Peak hour</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.calledNumber}>
                  <tr
                    className="clickable"
                    onClick={() => setExpandedNumber(expandedNumber === row.calledNumber ? null : row.calledNumber)}
                  >
                    <td>{row.calledNumber}</td>
                    <td>{row.market ?? ""}</td>
                    <td>{row.adName ?? ""}</td>
                    <td>{row.totalCalls}</td>
                    <td>{row.answeredPercent !== null ? `${row.answeredPercent.toFixed(0)}%` : ""}</td>
                    <td>{formatSeconds(row.avgCallSeconds)}</td>
                    <td>{row.peakHour !== null ? formatHour(row.peakHour) : ""}</td>
                    <td>{expandedNumber === row.calledNumber ? "▲" : "▼"}</td>
                  </tr>
                  {expandedNumber === row.calledNumber && (
                    <tr>
                      <td colSpan={8} style={{ background: "#fafafa" }}>
                        <h4 style={{ marginBottom: 4 }}>Calls by hour of day (UTC)</h4>
                        <BarChart
                          data={row.hourlyCounts.map((count, hour) => ({ label: String(hour), value: count }))}
                          formatLabel={(label) => formatHour(Number(label))}
                          height={140}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>No calls found for these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
