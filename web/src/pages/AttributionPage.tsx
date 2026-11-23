import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildAttributionExportUrl } from "../lib/api.js";
import CallDetailDrawer from "../components/CallDetailDrawer.js";

function formatTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// Mirrors ATTRIBUTION_START_ACTIONS in src/lib/attribution.ts - attribution only
// ever matches a click against a CallStartCall event, so the Action filter here
// offers just these two instead of every action in the field catalog (a
// CallProcessed or WebsiteEvent.Click choice would silently match nothing).
const START_ACTIONS = ["CallDetails.CallStartCall", "CallDetailsCustom.CallStartCall"];

interface AppliedParams {
  windowSeconds: number;
  requireSameNumber: boolean;
  market: string;
  utmSource: string;
  channel: string;
  adName: string;
  action: string;
}

export default function AttributionPage() {
  const queryClient = useQueryClient();

  // Draft controls - editable, not yet run until "Run attribution" is clicked.
  const [windowSeconds, setWindowSeconds] = useState(1800);
  const [requireSameNumber, setRequireSameNumber] = useState(false);
  const [market, setMarket] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [channel, setChannel] = useState("");
  const [adName, setAdName] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState<AppliedParams | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });
  const filterOptionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const settingsQuery = useQuery({ queryKey: ["attribution-settings"], queryFn: api.attributionSettings });

  // Seed the draft controls (and run the first query) from the saved default
  // exactly once, as soon as it loads - editing afterward never re-seeds them.
  useEffect(() => {
    if (!settingsQuery.data || applied) return;
    setWindowSeconds(settingsQuery.data.windowSeconds);
    setRequireSameNumber(settingsQuery.data.requireSameNumber);
    setApplied({
      windowSeconds: settingsQuery.data.windowSeconds,
      requireSameNumber: settingsQuery.data.requireSameNumber,
      market: "",
      utmSource: "",
      channel: "",
      adName: "",
      action: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  function buildParams(params: AppliedParams): URLSearchParams {
    const p = new URLSearchParams();
    p.set("windowSeconds", String(params.windowSeconds));
    p.set("requireSameNumber", String(params.requireSameNumber));
    if (params.market) p.set("market", params.market);
    if (params.utmSource) p.set("utmSource", params.utmSource);
    if (params.channel) p.set("channel", params.channel);
    if (params.adName) p.set("adName", params.adName);
    if (params.action) p.set("action", params.action);
    return p;
  }

  const attributionQuery = useQuery({
    queryKey: ["attribution", applied],
    queryFn: () => api.attribution(buildParams(applied as AppliedParams)),
    enabled: applied !== null,
  });

  function runAttribution() {
    setApplied({ windowSeconds, requireSameNumber, market, utmSource, channel, adName, action });
  }

  async function saveAsDefault() {
    await api.saveAttributionSettings({ windowSeconds, requireSameNumber });
    await queryClient.invalidateQueries({ queryKey: ["attribution-settings"] });
    setSavedMessage(`Saved as default: ${windowSeconds}s, ${requireSameNumber ? "same number required" : "any number"}.`);
    setTimeout(() => setSavedMessage(""), 4000);
  }

  const rows = attributionQuery.data?.rows ?? [];
  const matchedCount = rows.filter((r) => r.call !== null).length;
  const isDirty =
    applied !== null &&
    (applied.windowSeconds !== windowSeconds ||
      applied.requireSameNumber !== requireSameNumber ||
      applied.market !== market ||
      applied.utmSource !== utmSource ||
      applied.channel !== channel ||
      applied.adName !== adName ||
      applied.action !== action);

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
          <label>UTM Source (click)</label>
          <select value={utmSource} onChange={(e) => setUtmSource(e.target.value)}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.utmSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Channel (matched call)</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.channels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Ad Name (matched call)</label>
          <select value={adName} onChange={(e) => setAdName(e.target.value)}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.adNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Action (matched call)</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Any CallStartCall</option>
            {START_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
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
        <div className="field">
          <label>&nbsp;</label>
          <div className="flex-row">
            <button type="button" onClick={runAttribution}>
              {isDirty ? "Re-run attribution" : "Run attribution"}
            </button>
            <button type="button" className="secondary" onClick={saveAsDefault}>
              Save as default
            </button>
          </div>
        </div>
        <div className="field">
          <label>Export</label>
          {applied ? (
            <a href={buildAttributionExportUrl(buildParams(applied))}>
              <button type="button">Export linked (CSV)</button>
            </a>
          ) : (
            <button type="button" disabled>
              Export linked (CSV)
            </button>
          )}
        </div>
      </div>

      {savedMessage && <p className="hint">{savedMessage}</p>}
      {isDirty && <p className="hint">Settings changed - click "Re-run attribution" to apply them.</p>}

      <p className="hint">
        Best-estimate attribution only, computed on demand - never written to the database. A
        click only matches a CallStartCall event in the <strong>same market</strong> (always
        required) that started within the window above; "require same tracking number" narrows
        that further to a call placed to the exact number the click was attributed to, instead of
        any call into that market. "Export linked (CSV)" downloads only the matched pairs.
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
                  <td className="clickable" onClick={() => setSelectedCallId(row.click._id)}>
                    {formatTime(row.click.start_utc)}
                  </td>
                  <td>{row.click.site ?? ""}</td>
                  <td>{row.click.market ?? ""}</td>
                  <td>{row.click.utm_source ?? ""}</td>
                  <td>{row.click.called_number ?? ""}</td>
                  <td
                    className={row.call ? "clickable" : undefined}
                    onClick={() => row.call && setSelectedCallId(row.call._id)}
                  >
                    {row.call ? row.call.action : "no match"}
                  </td>
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

      {selectedCallId && <CallDetailDrawer id={selectedCallId} onClose={() => setSelectedCallId(null)} />}
    </div>
  );
}
