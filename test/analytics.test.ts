import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import { computeNumberBreakdown, computeDashboardStats } from "../src/lib/analytics.js";

async function ingestFixture(db: Db, rawBody: string) {
  const { rawDeliveryId } = await ingestRawDelivery(db, {
    headers: { "content-type": "application/json" },
    contentType: "application/json",
    rawBody,
  });
  await processDelivery(db, rawDeliveryId);
}

describe("analytics", () => {
  let mongo: TestMongo;

  afterEach(async () => {
    await mongo?.stop();
  });

  it("breaks down calls per target number, excluding website clicks", async () => {
    mongo = await startTestMongo();
    // Heartland start<->processed pair, same tracking number (8444476600).
    await ingestFixture(mongo.db, readFixture("14-heartland-start-9136261939.json").rawBody);
    await ingestFixture(mongo.db, readFixture("19-heartland-processed-9136261939.json").rawBody);
    // Unrelated website click to a different number - must not appear here.
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const rows = await computeNumberBreakdown(mongo.db, {});
    const heartlandRow = rows.find((r) => r.calledNumber === "8444476600");

    expect(heartlandRow).toBeDefined();
    expect(heartlandRow?.market).toBe("Heartland");
    expect(heartlandRow?.totalCalls).toBe(2);
    expect(heartlandRow?.answeredCalls).toBe(1);
    expect(heartlandRow?.answeredPercent).toBe(50);
    expect(heartlandRow?.hourlyCounts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(rows.some((r) => r.calledNumber === "8774557300")).toBe(false);
  });

  it("filters the number breakdown by market", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("14-heartland-start-9136261939.json").rawBody);
    await ingestFixture(mongo.db, readFixture("21-atlantic-custom-start-9542547114.json").rawBody);

    const rows = await computeNumberBreakdown(mongo.db, { market: "Atlantic Mens" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.calledNumber).toBe("8774557300");
  });

  it("computes dashboard stats including linking percentage", async () => {
    mongo = await startTestMongo();
    // A linked pair (custom family).
    await ingestFixture(mongo.db, readFixture("synthetic-custom-pair-start.json").rawBody);
    await ingestFixture(mongo.db, readFixture("synthetic-custom-pair-processed.json").rawBody);
    // An unlinked pair (different callers - never links).
    await ingestFixture(mongo.db, readFixture("23-tristate-custom-start-9379024706.json").rawBody);
    await ingestFixture(mongo.db, readFixture("24-tristate-custom-processed-4193573627.json").rawBody);
    // A website click, which must not count toward linking (no call_key).
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);

    const stats = await computeDashboardStats(mongo.db, {});

    expect(stats.totalClicks).toBe(1);
    expect(stats.totalCalls).toBe(4);
    // 4 linkable events (call_key set on all 4 custom-family events), 2 of them linked.
    expect(stats.linking.total).toBe(4);
    expect(stats.linking.linked).toBe(2);
    expect(stats.linking.percentage).toBe(50);

    // The click's market is unresolved here (no prior call seeded its tracking
    // number into tracking_numbers), so byMarket only reflects the synthetic pair.
    const atlanticMarket = stats.byMarket.find((m) => m.market === "Atlantic Mens");
    expect(atlanticMarket?.count).toBe(2);

    expect(stats.byHour.length).toBe(24);
    expect(stats.byHour.reduce((a, b) => a + b, 0)).toBe(5);

    const answered = stats.answerStatus.find((a) => a.status === "answered");
    expect(answered?.count).toBe(2);
  });

  it("returns a null linking percentage and empty breakdowns for an empty database", async () => {
    mongo = await startTestMongo();
    const stats = await computeDashboardStats(mongo.db, {});
    expect(stats.totalEvents).toBe(0);
    expect(stats.linking.percentage).toBeNull();
    expect(stats.byHour).toEqual(new Array(24).fill(0));
  });

  it("filters dashboard stats by utm_source, ad_name, and channel", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);
    await ingestFixture(mongo.db, readFixture("11-atlantic-processed-6164275708.json").rawBody);

    const byUtmSource = await computeDashboardStats(mongo.db, { utmSource: "google" });
    expect(byUtmSource.totalEvents).toBe(1);
    expect(byUtmSource.byAction[0]?.action).toBe("WebsiteEvent.Click");

    const byAdName = await computeDashboardStats(mongo.db, { adName: "Main Ad Phone" });
    expect(byAdName.totalEvents).toBe(1);

    const byChannel = await computeDashboardStats(mongo.db, { channel: "Paid Search" });
    expect(byChannel.totalEvents).toBe(1);
    expect(byChannel.byAction[0]?.action).toBe("CallDetails.CallProcessed");
  });

  it("filters dashboard stats by action", async () => {
    mongo = await startTestMongo();
    await ingestFixture(mongo.db, readFixture("20-website-click-atlantic-8774557300.json").rawBody);
    await ingestFixture(mongo.db, readFixture("11-atlantic-processed-6164275708.json").rawBody);

    const byAction = await computeDashboardStats(mongo.db, { action: "WebsiteEvent.Click" });
    expect(byAction.totalEvents).toBe(1);
    expect(byAction.totalClicks).toBe(1);
    expect(byAction.totalCalls).toBe(0);
  });
});
