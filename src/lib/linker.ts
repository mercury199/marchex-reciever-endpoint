import type { Db, ObjectId, WithId, Document } from "mongodb";

const START_ACTION = "CallDetails.CallStartCall";
const PROCESSED_ACTION = "CallDetails.CallProcessed";
const WINDOW_MS = 2 * 60 * 1000;

function counterpartAction(action: string | null): string | null {
  if (action === START_ACTION) return PROCESSED_ACTION;
  if (action === PROCESSED_ACTION) return START_ACTION;
  return null;
}

/** The UTC instant used for link-window comparison, per action type. */
function linkInstant(doc: WithId<Document>): Date | null {
  if (doc.action === START_ACTION) return doc.start_utc ?? null;
  if (doc.action === PROCESSED_ACTION) return doc.monitor_start_utc ?? null;
  return null;
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
