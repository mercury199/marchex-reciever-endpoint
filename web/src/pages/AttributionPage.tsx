import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

function formatTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function AttributionPage() {
  const [windowSeconds, setWindowSeconds] = useState(1800);
  const [requireSameNumber, setRequireSameNumber] = useState(false);
  const [market, setMarket] = useState("");

  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("windowSeconds", String(windowSeconds));
    params.set("requireSameNumber", String(requireSameNumber));
    if (market) params.set("market", market);
    return params;
  }

  const attributionQuery = useQuery({
    queryKey: ["attribution", windowSeconds, requireSameNumber, market],
    queryFn: () => api.attribution(buildParams()),
  });

  const rows = attributionQuery.data?.rows ?? [];
  const matchedCount = rows.filter((r) => r.call !== null).length;

  return (
    <div>
      <div className="toolbar">
        <div className="field">
          <label>Window (seconds after click)</label>
          <input
            type="number"
            min={1}
            value={windowSeconds}
            onChange={(e) => setWindowSeconds(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
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
          <label>
            <input
              type="checkbox"
              checked={requireSameNumber}
              onChange={(e) => setRequireSameNumber(e.target.checked)}
            />{" "}
            Require same tracking number
          </label>
        </div>
      </div>

      <p className="hint">
        Best-estimate attribution only, computed on demand - never written to the database. A
        click only matches a CallStartCall event in the <strong>same market</strong> (always
        required) that started within the window above; "require same tracking number" narrows
        that further to a call placed to the exact number the click was attributed to, instead of
        any call into that market.
      </p>

      {attributionQuery.isLoading && <p>Loading...</p>}
      {attributionQuery.isError && <p className="error-text">Failed to load attribution.</p>}

      {attributionQuery.data && (
        <>
          <p>
            {matchedCount} of {rows.length} clicks matched to a call.
          </p>
          <table>
            <thead>
              <tr>
                <th>Click time</th>
                <th>Site</th>
                <th>Market</th>
                <th>UTM source</th>
                <th>Tracking number</th>
                <th>Matched call</th>
                <th>Call start</th>
                <th>Caller number</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.click._id}>
                  <td>{formatTime(row.click.start_utc)}</td>
                  <td>{row.click.site ?? ""}</td>
                  <td>{row.click.market ?? ""}</td>
                  <td>{row.click.utm_source ?? ""}</td>
                  <td>{row.click.called_number ?? ""}</td>
                  <td>{row.call ? row.call.action : "no match"}</td>
                  <td>{row.call ? formatTime(row.call.start_utc) : ""}</td>
                  <td>{row.call ? row.call.caller_number ?? "" : ""}</td>
                  <td>{row.deltaSeconds !== null ? `${row.deltaSeconds.toFixed(0)}s` : ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9}>No website-click events found for these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
