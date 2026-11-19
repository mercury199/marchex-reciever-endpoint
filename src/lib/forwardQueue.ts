import type { Db, ObjectId, WithId, Document } from "mongodb";

const RESPONSE_TRUNCATE_LENGTH = 2000;

// Delay applied after the Nth failed attempt (1-indexed), capped at 1 hour.
const BACKOFF_SCHEDULE_MS = [60_000, 300_000, 1_200_000, 3_600_000];

export function delayAfterFailure(attemptsMade: number): number {
  const idx = Math.min(attemptsMade - 1, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]!;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

/** Claims the next due job (status=pending, next_attempt_at<=now) and marks it in_progress. */
async function claimNextJob(db: Db, now: Date): Promise<WithId<Document> | null> {
  const result = await db.collection("forward_jobs").findOneAndUpdate(
    { status: "pending", next_attempt_at: { $lte: now } },
    { $set: { status: "in_progress" } },
    { sort: { next_attempt_at: 1 }, returnDocument: "after" },
  );
  return result ?? null;
}

/** Executes one HTTP attempt for a claimed job and updates its status accordingly. */
export async function attemptJob(db: Db, job: WithId<Document>, fetchImpl: FetchLike): Promise<void> {
  const jobs = db.collection("forward_jobs");
  const [raw, target] = await Promise.all([
    db.collection("raw_deliveries").findOne({ _id: job.raw_delivery_id }),
    db.collection("forward_targets").findOne({ _id: job.target_id }),
  ]);

  if (!raw || !target || !target.enabled) {
    await jobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          last_attempt_at: new Date(),
          last_error: !raw ? "raw delivery no longer exists" : !target ? "target no longer exists" : "target disabled",
        },
      },
    );
    return;
  }

  const headers: Record<string, string> = {
    "content-type": raw.content_type ?? "application/octet-stream",
    ...(target.headers as Record<string, string> | undefined),
  };

  const attempts = (job.attempts as number) + 1;
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const response = await fetchImpl(target.url as string, {
      method: "POST",
      headers,
      body: raw.raw_body as string,
    });
    statusCode = response.status;
    responseBody = truncate(await response.text(), RESPONSE_TRUNCATE_LENGTH);
  } catch (err) {
    error = (err as Error).message;
  }

  const latencyMs = Date.now() - startedAt;
  const succeeded = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const maxAttempts = (job.max_attempts as number) ?? 5;

  if (succeeded) {
    await jobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "succeeded",
          attempts,
          last_attempt_at: new Date(),
          last_status_code: statusCode,
          last_latency_ms: latencyMs,
          last_response_body: responseBody,
          last_error: null,
        },
      },
    );
    return;
  }

  const exhausted = attempts >= maxAttempts;
  await jobs.updateOne(
    { _id: job._id },
    {
      $set: {
        status: exhausted ? "failed" : "pending",
        attempts,
        last_attempt_at: new Date(),
        last_status_code: statusCode,
        last_latency_ms: latencyMs,
        last_response_body: responseBody,
        last_error: error ?? `non-2xx status ${statusCode}`,
        ...(exhausted ? {} : { next_attempt_at: new Date(Date.now() + delayAfterFailure(attempts)) }),
      },
    },
  );
}

/** Claims and attempts every currently-due job, one at a time. */
export async function pollForwardJobs(db: Db, fetchImpl: FetchLike, now: Date = new Date()): Promise<number> {
  let processed = 0;
  for (;;) {
    const job = await claimNextJob(db, now);
    if (!job) break;
    await attemptJob(db, job, fetchImpl);
    processed += 1;
  }
  return processed;
}

/** Dashboard "retry" action: resets a failed job to pending, ready to be claimed immediately. */
export async function retryForwardJob(db: Db, jobId: ObjectId): Promise<boolean> {
  const result = await db.collection("forward_jobs").updateOne(
    { _id: jobId, status: "failed" },
    { $set: { status: "pending", attempts: 0, next_attempt_at: new Date(), last_error: null } },
  );
  return result.modifiedCount > 0;
}
