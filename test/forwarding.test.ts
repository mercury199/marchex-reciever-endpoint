import { afterEach, describe, expect, it } from "vitest";
import { startTestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { startCaptureServer, type CaptureServer } from "./helpers/captureServer.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import { delayAfterFailure, pollForwardJobs, retryForwardJob, type FetchLike } from "../src/lib/forwardQueue.js";
import { seedForwardTargets } from "../src/lib/forwardTargets.js";

const fetchImpl = fetch as unknown as FetchLike;

describe("forwarding queue", () => {
  let capture: CaptureServer | undefined;

  afterEach(async () => {
    await capture?.close();
    capture = undefined;
  });

  it("forwards the original raw body byte-for-byte, with original content-type, to a matching target", async () => {
    const mongo = await startTestMongo();
    capture = await startCaptureServer();
    await mongo.db.collection("forward_targets").insertOne({
      url: capture.url,
      enabled: true,
      action_filter: null,
      market_filter: null,
      headers: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const fixture = readFixture("08-atlantic-start-3053181246.json");
    const { rawDeliveryId } = await ingestRawDelivery(mongo.db, {
      headers: {},
      contentType: "application/json; charset=utf-8",
      rawBody: fixture.rawBody,
    });
    await processDelivery(mongo.db, rawDeliveryId);

    const processed = await pollForwardJobs(mongo.db, fetchImpl);
    expect(processed).toBe(1);

    expect(capture.requests).toHaveLength(1);
    expect(capture.requests[0]?.body).toBe(fixture.rawBody);
    expect(capture.requests[0]?.headers["content-type"]).toBe("application/json; charset=utf-8");

    const job = await mongo.db.collection("forward_jobs").findOne({ raw_delivery_id: rawDeliveryId });
    expect(job?.status).toBe("succeeded");
    expect(job?.attempts).toBe(1);
    expect(job?.last_status_code).toBe(200);

    await mongo.stop();
  });

  it("does not enqueue a job for a target whose action_filter doesn't match any event", async () => {
    const mongo = await startTestMongo();
    capture = await startCaptureServer();
    await mongo.db.collection("forward_targets").insertOne({
      url: capture.url,
      enabled: true,
      action_filter: "CallDetails.CallProcessed",
      market_filter: null,
      headers: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    // This fixture is a CallStartCall, so the CallProcessed-only target must not match.
    const fixture = readFixture("17-tristate-start-4196159231.json");
    const { rawDeliveryId } = await ingestRawDelivery(mongo.db, {
      headers: {},
      contentType: "application/json",
      rawBody: fixture.rawBody,
    });
    await processDelivery(mongo.db, rawDeliveryId);

    const jobCount = await mongo.db.collection("forward_jobs").countDocuments({ raw_delivery_id: rawDeliveryId });
    expect(jobCount).toBe(0);

    await mongo.stop();
  });

  it("enqueues and forwards for a target whose market_filter matches", async () => {
    const mongo = await startTestMongo();
    capture = await startCaptureServer();
    await mongo.db.collection("forward_targets").insertOne({
      url: capture.url,
      enabled: true,
      action_filter: null,
      market_filter: "Tri State",
      headers: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const fixture = readFixture("03-tristate-start-6145792186.json");
    const { rawDeliveryId } = await ingestRawDelivery(mongo.db, {
      headers: {},
      contentType: "application/json",
      rawBody: fixture.rawBody,
    });
    await processDelivery(mongo.db, rawDeliveryId);
    await pollForwardJobs(mongo.db, fetchImpl);

    expect(capture.requests).toHaveLength(1);

    await mongo.stop();
  });

  it("applies exponential backoff and marks the job failed after 5 exhausted attempts", async () => {
    const mongo = await startTestMongo();
    capture = await startCaptureServer();
    capture.responseQueue.push(500, 500, 500, 500, 500);
    await mongo.db.collection("forward_targets").insertOne({
      url: capture.url,
      enabled: true,
      action_filter: null,
      market_filter: null,
      headers: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const fixture = readFixture("18-atlantic-start-7542076055.json");
    const { rawDeliveryId } = await ingestRawDelivery(mongo.db, {
      headers: {},
      contentType: "application/json",
      rawBody: fixture.rawBody,
    });
    await processDelivery(mongo.db, rawDeliveryId);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // Bypass the real backoff wait so the test doesn't take up to an hour.
      await mongo.db
        .collection("forward_jobs")
        .updateMany({ raw_delivery_id: rawDeliveryId, status: "pending" }, { $set: { next_attempt_at: new Date() } });
      await pollForwardJobs(mongo.db, fetchImpl);
    }

    const job = await mongo.db.collection("forward_jobs").findOne({ raw_delivery_id: rawDeliveryId });
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(5);
    expect(capture.requests).toHaveLength(5);

    await mongo.stop();
  });

  it("retryForwardJob resets a failed job so it succeeds on the next poll", async () => {
    const mongo = await startTestMongo();
    capture = await startCaptureServer();
    capture.responseQueue.push(500);
    await mongo.db.collection("forward_targets").insertOne({
      url: capture.url,
      enabled: true,
      action_filter: null,
      market_filter: null,
      headers: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const fixture = readFixture("07-atlantic-start-6164275708.json");
    const { rawDeliveryId } = await ingestRawDelivery(mongo.db, {
      headers: {},
      contentType: "application/json",
      rawBody: fixture.rawBody,
    });
    await processDelivery(mongo.db, rawDeliveryId);

    // Force exhaustion in a single failing attempt.
    await mongo.db.collection("forward_jobs").updateMany({ raw_delivery_id: rawDeliveryId }, { $set: { max_attempts: 1 } });
    await pollForwardJobs(mongo.db, fetchImpl);

    let job = await mongo.db.collection("forward_jobs").findOne({ raw_delivery_id: rawDeliveryId });
    expect(job?.status).toBe("failed");

    const retried = await retryForwardJob(mongo.db, job!._id);
    expect(retried).toBe(true);

    await pollForwardJobs(mongo.db, fetchImpl);
    job = await mongo.db.collection("forward_jobs").findOne({ raw_delivery_id: rawDeliveryId });
    expect(job?.status).toBe("succeeded");
    expect(capture.requests).toHaveLength(2);

    await mongo.stop();
  });

  it("seeds forward_targets from FORWARD_URLS idempotently", async () => {
    const mongo = await startTestMongo();
    await seedForwardTargets(mongo.db, ["https://example.com/a", "https://example.com/b"]);
    await seedForwardTargets(mongo.db, ["https://example.com/a", "https://example.com/b"]);

    const count = await mongo.db.collection("forward_targets").countDocuments({});
    expect(count).toBe(2);

    await mongo.stop();
  });
});

describe("delayAfterFailure", () => {
  it("follows the 1m / 5m / 20m / 60m-capped schedule", () => {
    expect(delayAfterFailure(1)).toBe(60_000);
    expect(delayAfterFailure(2)).toBe(300_000);
    expect(delayAfterFailure(3)).toBe(1_200_000);
    expect(delayAfterFailure(4)).toBe(3_600_000);
    expect(delayAfterFailure(5)).toBe(3_600_000);
    expect(delayAfterFailure(99)).toBe(3_600_000);
  });
});
