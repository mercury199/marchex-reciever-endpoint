import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { buildTestApp, TEST_CONFIG } from "./helpers/testApp.js";

/**
 * Regression coverage for a real bug: Fastify's built-in exact-match
 * "application/json" content-type parser takes priority over a wildcard parser
 * registered in a child scope, unless removeAllContentTypeParsers() is called
 * first. ingestRawDelivery()-level tests (test/ingest.test.ts) call that function
 * directly and never exercise Fastify's actual body parsing, so they can't catch
 * this - only a real HTTP request through the app can.
 */
describe("webhook HTTP route", () => {
  let mongo: TestMongo;
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it("stores the exact raw JSON body sent with content-type: application/json", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    const fixture = readFixture("03-tristate-start-6145792186.json");

    const response = await app.inject({
      method: "POST",
      url: `/webhooks/marchex/${TEST_CONFIG.webhookToken}`,
      headers: { "content-type": "application/json" },
      payload: fixture.rawBody,
    });
    expect(response.statusCode).toBe(200);

    const stored = await mongo.db.collection("raw_deliveries").findOne({});
    expect(stored?.raw_body).toBe(fixture.rawBody);
    expect(stored?.parse_error).toBeNull();

    // Give the fire-and-forget processDelivery() a tick to finish.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const eventCount = await mongo.db.collection("call_events").countDocuments({});
    expect(eventCount).toBe(1);
  });

  it("rejects a mismatched webhook token with 404 and stores nothing", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    const fixture = readFixture("03-tristate-start-6145792186.json");

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/marchex/wrong-token",
      headers: { "content-type": "application/json" },
      payload: fixture.rawBody,
    });
    expect(response.statusCode).toBe(404);

    const count = await mongo.db.collection("raw_deliveries").countDocuments({});
    expect(count).toBe(0);
  });

  it("still returns 200 and stores a malformed, non-JSON body", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);

    const response = await app.inject({
      method: "POST",
      url: `/webhooks/marchex/${TEST_CONFIG.webhookToken}`,
      headers: { "content-type": "application/json" },
      payload: "{not valid json at all",
    });
    expect(response.statusCode).toBe(200);

    const stored = await mongo.db.collection("raw_deliveries").findOne({});
    expect(stored?.raw_body).toBe("{not valid json at all");
    expect(stored?.parse_error).toContain("invalid JSON");
  });
});
