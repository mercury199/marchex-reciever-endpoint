import { ObjectId, type Db, type WithId, type Document } from "mongodb";
import { normalizeNotification } from "./lib/normalize.js";
import { recordFieldCatalog } from "./lib/fieldCatalog.js";
import { linkNewEvent } from "./lib/linker.js";
import { enqueueForwardJobs, type EventSummary } from "./lib/forwarding.js";

export interface IncomingDelivery {
  headers: Record<string, string>;
  contentType: string | null;
  rawBody: string;
}

export interface IngestResult {
  rawDeliveryId: ObjectId;
  duplicate: boolean;
}

/**
 * Step 3 of docs/DESIGN.md §4: stores the raw delivery. This is the ONLY Mongo
 * write on the webhook request's critical path - everything else happens in
 * processDelivery, which the caller should invoke without awaiting.
 */
export async function ingestRawDelivery(db: Db, delivery: IncomingDelivery): Promise<IngestResult> {
  const receivedAt = new Date();

  let parsed: unknown;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(delivery.rawBody);
  } catch (err) {
    parseError = `invalid JSON: ${(err as Error).message}`;
  }

  let requestId: string | null = null;
  let attempt: number | null = null;

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const properties = obj.Properties as Record<string, unknown> | undefined;
    requestId = typeof properties?.RequestId === "string" ? properties.RequestId : null;
    attempt = typeof obj.Attempt === "number" ? obj.Attempt : null;

    const missing: string[] = [];
    if (!Array.isArray(obj.Notifications)) missing.push("Notifications array");
    if (!requestId) missing.push("Properties.RequestId");
    if (missing.length > 0) {
      parseError = parseError ?? `missing ${missing.join(" and ")}`;
    }
  }

  const doc = {
    request_id: requestId,
    received_at: receivedAt,
    headers: delivery.headers,
    content_type: delivery.contentType,
    raw_body: delivery.rawBody,
    parse_error: parseError,
    attempt,
    processed_at: null as Date | null,
    processing_error: null as string | null,
  };

  try {
    const result = await db.collection("raw_deliveries").insertOne(doc);
    return { rawDeliveryId: result.insertedId, duplicate: false };
  } catch (err) {
    if (isDuplicateKeyError(err) && requestId) {
      const existing = await db.collection("raw_deliveries").findOne({ request_id: requestId });
      if (existing) {
        return { rawDeliveryId: existing._id, duplicate: true };
      }
    }
    throw err;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Explodes Notifications[] into call_events, updates field_catalog, resolves
 * market/advertiser, attempts start<->processed linking, and (optionally)
 * enqueues forward jobs. Shared by processDelivery (first ingest) and
 * reprocessDelivery (dashboard "reprocess" action on an existing raw delivery).
 */
async function explodeNotifications(
  db: Db,
  raw: WithId<Document>,
  rawDeliveryId: ObjectId,
  options: { enqueueForwarding: boolean },
): Promise<void> {
  const parsed = JSON.parse(raw.raw_body as string) as Record<string, unknown>;
  const notifications = parsed.Notifications;

  if (!Array.isArray(notifications)) {
    if (options.enqueueForwarding) await enqueueForwardJobs(db, rawDeliveryId, []);
    return;
  }

  const eventSummaries: EventSummary[] = [];

  for (let index = 0; index < notifications.length; index += 1) {
    const data = notifications[index] as Record<string, unknown>;
    const normalized = await normalizeNotification(db, data);

    const eventDoc = {
      raw_delivery_id: rawDeliveryId,
      request_id: raw.request_id as string,
      notification_index: index,
      data,
      ...normalized,
      linked_event_id: null as ObjectId | null,
      linked_request_id: null as string | null,
      created_at: new Date(),
    };

    let insertedId: ObjectId;
    try {
      const result = await db.collection("call_events").insertOne(eventDoc);
      insertedId = result.insertedId;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await db
          .collection("call_events")
          .findOne({ request_id: raw.request_id, notification_index: index });
        if (!existing) throw err;
        insertedId = existing._id;
      } else {
        throw err;
      }
    }

    await recordFieldCatalog(db, data);
    await linkNewEvent(db, insertedId);
    eventSummaries.push({ action: normalized.action, market: normalized.market });
  }

  if (options.enqueueForwarding) {
    await enqueueForwardJobs(db, rawDeliveryId, eventSummaries);
  }
}

/**
 * Step 5 of docs/DESIGN.md §4: first-time processing of a raw delivery.
 * Never throws - failures are recorded on the raw_deliveries document instead.
 */
export async function processDelivery(db: Db, rawDeliveryId: ObjectId): Promise<void> {
  const rawDeliveries = db.collection("raw_deliveries");
  const raw = await rawDeliveries.findOne({ _id: rawDeliveryId });
  if (!raw) return;

  // Resend / already-processed: skip re-exploding (covers Attempt > 1 retries).
  const alreadyProcessed = await db.collection("call_events").countDocuments({ raw_delivery_id: rawDeliveryId }, { limit: 1 });
  if (alreadyProcessed > 0) return;

  try {
    await explodeNotifications(db, raw, rawDeliveryId, { enqueueForwarding: true });
    await rawDeliveries.updateOne(
      { _id: rawDeliveryId },
      { $set: { processed_at: new Date(), processing_error: null } },
    );
  } catch (err) {
    await rawDeliveries.updateOne(
      { _id: rawDeliveryId },
      { $set: { processed_at: new Date(), processing_error: (err as Error).message } },
    );
  }
}

/**
 * Dashboard "reprocess" action (raw deliveries page): re-derives call_events from
 * the stored raw_body, e.g. after the normalizer changes. Deletes the delivery's
 * existing call_events (unlinking any counterpart that pointed at them) and rebuilds
 * them from scratch. Does NOT re-enqueue forwarding - the original byte-for-byte
 * forward already happened when the delivery first arrived.
 */
export async function reprocessDelivery(db: Db, rawDeliveryId: ObjectId): Promise<void> {
  const rawDeliveries = db.collection("raw_deliveries");
  const raw = await rawDeliveries.findOne({ _id: rawDeliveryId });
  if (!raw) throw new Error("raw delivery not found");

  const oldEvents = await db.collection("call_events").find({ raw_delivery_id: rawDeliveryId }, { projection: { _id: 1 } }).toArray();
  const oldIds = oldEvents.map((e) => e._id);

  if (oldIds.length > 0) {
    await db
      .collection("call_events")
      .updateMany({ linked_event_id: { $in: oldIds } }, { $set: { linked_event_id: null, linked_request_id: null } });
    await db.collection("call_events").deleteMany({ raw_delivery_id: rawDeliveryId });
  }

  try {
    await explodeNotifications(db, raw, rawDeliveryId, { enqueueForwarding: false });
    await rawDeliveries.updateOne(
      { _id: rawDeliveryId },
      { $set: { processed_at: new Date(), processing_error: null } },
    );
  } catch (err) {
    await rawDeliveries.updateOne(
      { _id: rawDeliveryId },
      { $set: { processed_at: new Date(), processing_error: (err as Error).message } },
    );
    throw err;
  }
}
