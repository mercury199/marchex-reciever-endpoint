import type { Db, ObjectId, WithId, Document } from "mongodb";

const LEGACY_START = "CallDetails.CallStartCall";
const LEGACY_PROCESSED = "CallDetails.CallProcessed";
const CUSTOM_START = "CallDetailsCustom.CallStartCall";
const CUSTOM_PROCESSED = "CallDetailsCustom.CallProcessed";
const WINDOW_MS = 2 * 60 * 1000;

/**
 * Each known action type's start/processed counterpart, per docs/DESIGN.md §5 -
 * generalized to cover both the legacy CallDetails.* family and the newer
 * CallDetailsCustom.* family (see lib/normalize.ts). Any other action type
 * (including the synthetic WebsiteEvent.Click) has no counterpart here and is
 * never linked by this function - website-click-to-call attribution is a
 * separate, on-demand feature (lib/attribution.ts), not a stored link.
 */
function counterpartAction(action: string | null): string | null {
  switch (action) {
    case LEGACY_START:
      return LEGACY_PROCESSED;
    case LEGACY_PROCESSED:
      return LEGACY_START;
    case CUSTOM_START:
      return CUSTOM_PROCESSED;
    case CUSTOM_PROCESSED:
      return CUSTOM_START;
    default:
      return null;
  }
}

/** The UTC instant used for link-window comparison, per action type. */
function linkInstant(doc: WithId<Document>): Date | null {
  switch (doc.action) {
    case LEGACY_START:
      return doc.start_utc ?? null;
    case LEGACY_PROCESSED:
      return doc.monitor_start_utc ?? null;
    // The CallDetailsCustom family has no separate "monitor" instant - normalize.ts
    // sets monitor_start_utc equal to start_utc on both sides of this pair, so both
    // cases below read the same field for clarity at the call site.
    case CUSTOM_START:
    case CUSTOM_PROCESSED:
      return doc.monitor_start_utc ?? null;
    default:
      return null;
  }
}

/**
 * Attempts to link a newly-inserted call_events document to its start/processed
 * counterpart, per docs/DESIGN.md §5. No-op (leaves linked_event_id: null) if the
 * event has no call_key, its action type has no defined counterpart, or no
 * unlinked candidate falls within the ±2 minute window.
 */
export async function linkNewEvent(db: Db, newEventId: ObjectId): Promise<void> {
  const callEvents = db.collection("call_events");
  const newEvent = await callEvents.findOne({ _id: newEventId });
  if (!newEvent || !newEvent.call_key) return;

  const wantAction = counterpartAction(newEvent.action);
  if (!wantAction) return;

  const newInstant = linkInstant(newEvent);
  if (!newInstant) return;

  const candidates = await callEvents
    .find({
      call_key: newEvent.call_key,
      action: wantAction,
      linked_event_id: null,
      _id: { $ne: newEventId },
    })
    .toArray();

  let best: WithId<Document> | null = null;
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    const candidateInstant = linkInstant(candidate);
    if (!candidateInstant) continue;
    const delta = Math.abs(candidateInstant.getTime() - newInstant.getTime());
    if (delta <= WINDOW_MS && delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }

  if (!best) return;

  await callEvents.updateOne(
    { _id: newEvent._id },
    { $set: { linked_event_id: best._id, linked_request_id: best.request_id ?? null } },
  );
  await callEvents.updateOne(
    { _id: best._id },
    { $set: { linked_event_id: newEvent._id, linked_request_id: newEvent.request_id ?? null } },
  );
}
