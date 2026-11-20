import CallsExplorer from "../components/CallsExplorer.js";

// Promoted fields are uniform across every action family (legacy CallDetails.*,
// CallDetailsCustom.*, and the synthetic WebsiteEvent.Click) - see
// src/lib/normalize.ts - so one default column set reads sensibly for all three;
// a field that doesn't apply to a given row's action just renders blank.
const DEFAULT_COLUMNS = [
  "start_utc",
  "market",
  "action",
  "ad_name",
  "caller_number",
  "called_number",
  "answer_status",
  "call_seconds",
  "channel",
  "paid",
  "registered_dnc",
  "site",
  "utm_source",
];

export default function CallsPage() {
  return <CallsExplorer defaultColumns={DEFAULT_COLUMNS} />;
}
