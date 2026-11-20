import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import { computeAttribution } from "../src/lib/attribution.js";

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
