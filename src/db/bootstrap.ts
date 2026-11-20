import type { Db } from "mongodb";

/**
 * Idempotently creates every collection and index the app's queries rely on.
 * Safe to run against a brand-new, empty Mongo, and safe to re-run on every boot.
 */
export async function bootstrapDatabase(db: Db): Promise<void> {
  await db.createCollection("raw_deliveries").catch(ignoreExists);
  await db.createCollection("call_events").catch(ignoreExists);
  await db.createCollection("field_catalog").catch(ignoreExists);
  await db.createCollection("advertisers").catch(ignoreExists);
  await db.createCollection("tracking_numbers").catch(ignoreExists);
  await db.createCollection("settings").catch(ignoreExists);
  await db.createCollection("forward_targets").catch(ignoreExists);
  await db.createCollection("forward_jobs").catch(ignoreExists);

  await db.collection("raw_deliveries").createIndex(
    { request_id: 1 },
    {
      unique: true,
      partialFilterExpression: { request_id: { $type: "string" } },
      name: "uniq_request_id",
    },
  );

  const callEvents = db.collection("call_events");
  await callEvents.createIndex(
    { request_id: 1, notification_index: 1 },
    { unique: true, name: "uniq_request_notification" },
  );
  await callEvents.createIndex({ market: 1, start_utc: 1 }, { name: "market_start" });
  await callEvents.createIndex({ caller_number: 1 }, { name: "caller_number" });
  await callEvents.createIndex({ called_number: 1 }, { name: "called_number" });
  await callEvents.createIndex({ action: 1 }, { name: "action" });
  await callEvents.createIndex({ registered_dnc: 1 }, { name: "registered_dnc" });
  await callEvents.createIndex({ telmetrics_id: 1 }, { name: "telmetrics_id" });
  await callEvents.createIndex(
    { call_key: 1, linked_event_id: 1 },
    { name: "call_key_linked" },
  );

  await db
    .collection("field_catalog")
    .createIndex({ path: 1 }, { unique: true, name: "uniq_path" });

  await db
    .collection("forward_jobs")
    .createIndex({ status: 1, next_attempt_at: 1 }, { name: "status_next_attempt" });
}

function ignoreExists(err: unknown): void {
  const code = (err as { codeName?: string } | undefined)?.codeName;
  if (code === "NamespaceExists") return;
  throw err;
}
