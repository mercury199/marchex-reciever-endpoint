import CallsExplorer from "../components/CallsExplorer.js";

// Website-click-only fields (src/lib/normalize.ts's normalizeWebsiteClick) come
// first since every other promoted column (ad_name, caller_number, etc.) is
// always blank on this action, per DESIGN.md's addendum.
const DEFAULT_COLUMNS = [
  "start_utc",
  "market",
  "site",
  "called_number",
  "utm_source",
  "utm_campaign",
  "landing_page",
  "referrer",
  "end_utc",
];

/** Same table/filter/export UI as Calls, locked to action: WebsiteEvent.Click. */
export default function WebsiteEventsPage() {
  return (
    <CallsExplorer
      defaultColumns={DEFAULT_COLUMNS}
      fixedFilters={[{ path: "action", operator: "equals", value: "WebsiteEvent.Click" }]}
    />
  );
}
