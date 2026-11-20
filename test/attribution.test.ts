import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { FastifyInstance } from "fastify";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import { computeAttribution } from "../src/lib/attribution.js";
import { buildTestApp, loginAndGetCookie } from "./helpers/testApp.js";

async function ingestFixture(db: Db, rawBody: string) {
  const { rawDeliveryId } = await ingestRawDelivery(db, {
    headers: { "content-type": "application/json" },
    contentType: "application/json",
    rawBody,
  });
  await processDelivery(db, rawDeliveryId);
}

describe("website-click attribution (best estimate, never stored)", () => {
  let mongo: TestMongo;

  afterEach(async () => {
    await mongo?.stop();
  });

  it("matches a click to the nearest same-market CallStartCall within the window", async () => {
    mongo = await startTestMongo();
    // Seeds tracking_numbers[8774557300] = "Atlantic Mens" so the click below resolves
    // the same market as the call, which attribution requires as a hard match.
    await ingestFixture(mongo.db, readFixture("21-atlantic-custom-start-9542547114.json").rawBody);
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const rows = await computeAttribution(mongo.db, { windowSeconds: 3600, requireSameNumber: false });
    const clickRow = rows.find((r) => r.click.action === "WebsiteEvent.Click");
    expect(clickRow).toBeDefined();
    expect(clickRow?.call?.caller_number).toBe("9542547114");
    expect(clickRow?.deltaSeconds).not.toBeNull();
  });

  it("does not match across markets even within the window", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("21-atlantic-custom-start-9542547114.json").rawBody);
    await ingestFixture(mongo.db, readFixture("23-tristate-custom-start-9379024706.json").rawBody);
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const rows = await computeAttribution(mongo.db, { windowSeconds: 3600, requireSameNumber: false, market: "Atlantic Mens" });
    const clickRow = rows.find((r) => r.click.action === "WebsiteEvent.Click");
    expect(clickRow?.call?.caller_number).toBe("9542547114");
  });

  it("requireSameNumber excludes a same-market call to a different tracking number", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("21-atlantic-custom-start-9542547114.json").rawBody);
    await ingestFixture(mongo.db, readFixture("22-atlantic-custom-processed-2395259168.json").rawBody);
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const rows = await computeAttribution(mongo.db, { windowSeconds: 3600, requireSameNumber: true });
    const clickRow = rows.find((r) => r.click.action === "WebsiteEvent.Click");
    // The click's tracking number (8774557300) only matches the CallStartCall fixture,
    // not the CallProcessed one (tracking number 2399631555) - same-number mode must
    // still find the matching one, not reject the click outright.
    expect(clickRow?.call?.caller_number).toBe("9542547114");
  });

  it("reports no match when nothing starts within the window", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const rows = await computeAttribution(mongo.db, { windowSeconds: 60, requireSameNumber: false });
    const clickRow = rows.find((r) => r.click.action === "WebsiteEvent.Click");
    expect(clickRow?.call).toBeNull();
    expect(clickRow?.deltaSeconds).toBeNull();
  });
});

describe("attribution settings and export (HTTP)", () => {
  let mongo: TestMongo;
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it("returns built-in defaults until a default is saved, then persists it", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    const cookie = await loginAndGetCookie(app);

    const before = await app.inject({ method: "GET", url: "/api/settings/attribution", headers: { cookie } });
    expect(before.json()).toEqual({ windowSeconds: 1800, requireSameNumber: false });

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings/attribution",
      headers: { cookie, "content-type": "application/json" },
      payload: { windowSeconds: 7200, requireSameNumber: true },
    });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/settings/attribution", headers: { cookie } });
    expect(after.json()).toEqual({ windowSeconds: 7200, requireSameNumber: true });
  });

  it("rejects an invalid attribution settings payload", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/settings/attribution",
      headers: { cookie, "content-type": "application/json" },
      payload: { windowSeconds: -5, requireSameNumber: "yes" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("exports only matched pairs as CSV", async () => {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    const cookie = await loginAndGetCookie(app);

    await ingestFixture(mongo.db, readFixture("21-atlantic-custom-start-9542547114.json").rawBody);
    await ingestFixture(mongo.db, readFixture("23-tristate-custom-start-9379024706.json").rawBody);
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const response = await app.inject({
      method: "GET",
      url: "/api/attribution/export.csv?windowSeconds=3600&requireSameNumber=false",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");

    const lines = response.body.trim().split("\n");
    expect(lines[0]).toBe(
      "click_start_utc,site,market,utm_source,tracking_number,matched_action,call_start_utc,caller_number,delta_seconds",
    );
    // Only the matched Atlantic click<->call pair, not the unrelated Tri State call.
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("9542547114");
    expect(lines[1]).not.toContain("9379024706");
  });
});
