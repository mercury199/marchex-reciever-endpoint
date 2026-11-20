/**
 * Marchex's "website event" deliveries (click/attribution tracking) have an
 * entirely different top-level shape from the Notifications[]/Properties
 * CallDetails(Custom) deliveries: no Action, no Notifications array, no
 * Properties.RequestId - just `received_from_browser` / `sent_to_marchex` /
 * `marchex_response` / `site` at the top level. Detecting this shape is shared
 * between ingest.ts (deciding how to store/explode a raw delivery) and
 * normalize.ts (deciding how to derive promoted fields from a notification).
 */
export function isWebsiteClickShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.received_from_browser === "object" &&
    obj.received_from_browser !== null &&
    typeof obj.sent_to_marchex === "object" &&
    obj.sent_to_marchex !== null
  );
}
