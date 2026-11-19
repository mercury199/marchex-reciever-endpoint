import type { Db, ObjectId } from "mongodb";
import type { ForwardTarget } from "./forwardTargets.js";

export interface EventSummary {
  action: string | null;
  market: string | null;
}

/**
 * A target matches a delivery if at least one of its events satisfies both the
 * target's action_filter and market_filter (null filter = wildcard). A delivery
 * with no events at all (e.g. unparseable body) only matches targets with no
 * filters at all, since there's nothing to filter on.
 */
export function targetMatchesDelivery(target: Pick<ForwardTarget, "action_filter" | "market_filter">, events: EventSummary[]): boolean {
  if (events.length === 0) {
    return target.action_filter === null && target.market_filter === null;
  }
  return events.some(
    (e) =>
      (target.action_filter === null || e.action === target.action_filter) &&
      (target.market_filter === null || e.market === target.market_filter),
  );
}

/**
 * Enqueues one forward_jobs document per enabled target that matches this delivery's
 * events. Idempotent in practice because the caller (processDelivery) only runs this
 * once per raw delivery - it never reprocesses a delivery that already has call_events.
 */
export async function enqueueForwardJobs(db: Db, rawDeliveryId: ObjectId, events: EventSummary[]): Promise<void> {
  const targets = await db.collection("forward_targets").find({ enabled: true }).toArray();
  if (targets.length === 0) return;

  const now = new Date();
  const jobs = targets
    .filter((target) => targetMatchesDelivery(target as unknown as ForwardTarget, events))
    .map((target) => ({
      raw_delivery_id: rawDeliveryId,
      target_id: target._id,
      status: "pending" as const,
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: now,
      last_attempt_at: null,
      last_status_code: null,
      last_latency_ms: null,
      last_response_body: null,
      last_error: null,
      created_at: now,
    }));

  if (jobs.length > 0) {
    await db.collection("forward_jobs").insertMany(jobs);
  }
}
