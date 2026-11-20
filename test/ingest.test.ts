import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import { isWebsiteClickShape } from "../src/lib/payloadShape.js";

async function ingestFixture(db: Db, rawBody: string) {
  const { rawDeliveryId, duplicate } = await ingestRawDelivery(db, {
    headers: { "content-type": "application/json" },
    contentType: "application/json",
    rawBody,
  });
  await processDelivery(db, rawDeliveryId);
  return { rawDeliveryId, duplicate };
}

describe("ingest pipeline", () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  it("creates exactly one call_events document per Notifications[] entry, across every fixture", async () => {
    const fixtures = listFixtures();
    let expectedEventCount = 0;

    for (const fixture of fixtures) {
      const parsed = JSON.parse(fixture.rawBody) as { Notifications?: unknown[] };
      // Website-click fixtures have no Notifications[] wrapper - the whole body is
      // exploded as a single synthetic notification (see lib/payloadShape.ts).
      expectedEventCount += Array.isArray(parsed.Notifications) ? parsed.Notifications.length : isWebsiteClickShape(parsed) ? 1 : 0;
      await ingestFixture(mongo.db, fixture.rawBody);
    }

    const actualEventCount = await mongo.db.collection("call_events").countDocuments({});
    expect(actualEventCount).toBe(expectedEventCount);

    const deliveryCount = await mongo.db.collection("raw_deliveries").countDocuments({});
    expect(deliveryCount).toBe(fixtures.length);
  });

  it("dedupes a resent delivery (same RequestId) instead of creating duplicate events", async () => {
    const db = (await startTestMongo()).db;
    const fixture = readFixture("17-tristate-start-4196159231.json");

    const first = await ingestFixture(db, fixture.rawBody);
    expect(first.duplicate).toBe(false);

    const second = await ingestFixture(db, fixture.rawBody);
    expect(second.duplicate).toBe(true);
    expect(second.rawDeliveryId.equals(first.rawDeliveryId)).toBe(true);

    const deliveryCount = await db.collection("raw_deliveries").countDocuments({});
    expect(deliveryCount).toBe(1);

    const eventCount = await db.collection("call_events").countDocuments({});
    expect(eventCount).toBe(1);
  });

  it("resolves market for a CallStartCall lacking AdvertiserName via OrgGroupName fallback", async () => {
    const mongo2 = await startTestMongo();
    try {
      // 02-atlantic-start-*.json carries only AdvertiserID (no AdvertiserName), and no
      // CallProcessed for that advertiser has been ingested yet in this fresh db, so the
      // advertisers lookup is empty and resolution MUST fall back to OrgGroupName.
      const fixture = readFixture("02-atlantic-start-5175959584.json");
      await ingestFixture(mongo2.db, fixture.rawBody);

      const event = await mongo2.db.collection("call_events").findOne({ caller_number: "5175959584" });
      expect(event).not.toBeNull();
      expect(event?.action).toBe("CallDetails.CallStartCall");
      expect(event?.data.AdvertiserDetails.AdvertiserName).toBeUndefined();
      expect(event?.market).toBe("Atlantic Mens");
    } finally {
      await mongo2.stop();
    }
  });

  it("resolves market via AdvertiserName, and backfills the advertisers lookup, for CallProcessed", async () => {
    const fixture = readFixture("11-atlantic-processed-6164275708.json");
    await ingestFixture(mongo.db, fixture.rawBody);

    const event = await mongo.db.collection("call_events").findOne({ caller_number: "6164275708", action: "CallDetails.CallProcessed" });
    expect(event?.market).toBe("Atlantic Mens");

    const advertiser = await mongo.db.collection("advertisers").findOne({ _id: 7235236 as unknown as never });
    expect(advertiser?.name).toBe("Atlantic Mens");
  });

  it("normalizes local StartTime to UTC correctly for Eastern, Central, and Mountain", async () => {
    const db = (await startTestMongo()).db;

    const eastern = readFixture("01-atlantic-processed-3018456823.json");
    await ingestFixture(db, eastern.rawBody);
    const easternEvent = await db.collection("call_events").findOne({ caller_number: "3018456823" });
    expect(easternEvent?.timezone).toBe("America/New_York");
    expect((easternEvent?.start_utc as Date).toISOString()).toBe("2026-11-19T18:22:43.000Z");

    const central = readFixture("19-heartland-processed-9136261939.json");
    await ingestFixture(db, central.rawBody);
    const centralEvent = await db.collection("call_events").findOne({ caller_number: "9136261939", action: "CallDetails.CallProcessed" });
    expect(centralEvent?.timezone).toBe("America/Chicago");
    expect((centralEvent?.start_utc as Date).toISOString()).toBe("2026-11-19T18:33:42.000Z");

    const mountain = readFixture("10-rockymountain-processed-report-5095756990.json");
    await ingestFixture(db, mountain.rawBody);
    const mountainEvent = await db.collection("call_events").findOne({ caller_number: "5095756990" });
    expect(mountainEvent?.timezone).toBe("America/Denver");
    expect((mountainEvent?.start_utc as Date).toISOString()).toBe("2026-11-19T18:11:00.000Z");
  });

  it("links the start<->processed Heartland pair for caller 9136261939", async () => {
    const db = (await startTestMongo()).db;
    const start = readFixture("14-heartland-start-9136261939.json");
    const processed = readFixture("19-heartland-processed-9136261939.json");

    await ingestFixture(db, start.rawBody);
    await ingestFixture(db, processed.rawBody);

    const startEvent = await db.collection("call_events").findOne({ caller_number: "9136261939", action: "CallDetails.CallStartCall" });
    const processedEvent = await db.collection("call_events").findOne({ caller_number: "9136261939", action: "CallDetails.CallProcessed" });

    expect(startEvent?.linked_event_id).not.toBeNull();
    expect(processedEvent?.linked_event_id).not.toBeNull();
    expect(startEvent?.linked_event_id?.equals(processedEvent?._id)).toBe(true);
    expect(processedEvent?.linked_event_id?.equals(startEvent?._id)).toBe(true);
  });

  it("does not link the Rocky Mountain 'report' start/processed pair, since their callers differ", async () => {
    const db = (await startTestMongo()).db;
    const start = readFixture("04-rockymountain-start-report-2103661898.json");
    const processed = readFixture("10-rockymountain-processed-report-5095756990.json");

    await ingestFixture(db, start.rawBody);
    await ingestFixture(db, processed.rawBody);

    const startEvent = await db.collection("call_events").findOne({ caller_number: "2103661898" });
    const processedEvent = await db.collection("call_events").findOne({ caller_number: "5095756990" });

    expect(startEvent?.linked_event_id).toBeNull();
    expect(processedEvent?.linked_event_id).toBeNull();
  });

  it("survives an unknown Action with an extra nested field and a renamed field", async () => {
    const db = (await startTestMongo()).db;
    const fixture = readFixture("synthetic-unknown-action.json");
    await ingestFixture(db, fixture.rawBody);

    const event = await db.collection("call_events").findOne({ "data.Action": "CallDetails.CallVoicemail" });
    expect(event).not.toBeNull();
    expect(event?.action).toBe("CallDetails.CallVoicemail");

    // Renamed field (CallerPhoneNumber instead of CallerNumber): the promoted field stays
    // null, but the raw value is untouched inside `data`.
    expect(event?.caller_number).toBeNull();
    expect(event?.data.CallerPhoneNumber).toBe("9995551234");

    // Extra nested field survives untouched and is picked up by the field catalog.
    expect(event?.data.Extra.Nested.Field).toBe(true);

    const catalogEntry = await db.collection("field_catalog").findOne({ path: "Extra.Nested.Field" });
    expect(catalogEntry?.types_seen).toContain("boolean");

    const renamedFieldEntry = await db.collection("field_catalog").findOne({ path: "CallerPhoneNumber" });
    expect(renamedFieldEntry?.types_seen).toContain("string");
  });

  it("normalizes the CallDetailsCustom family and resolves market from account.group_owner_name", async () => {
    const db = (await startTestMongo()).db;
    const start = readFixture("21-atlantic-custom-start-9542547114.json");
    await ingestFixture(db, start.rawBody);

    const event = await db.collection("call_events").findOne({ caller_number: "9542547114" });
    expect(event?.action).toBe("CallDetailsCustom.CallStartCall");
    expect(event?.market).toBe("Atlantic Mens");
    expect(event?.called_number).toBe("8774557300");
    expect(event?.study_id).toBe(13994877);
    expect((event?.start_utc as Date).toISOString()).toBe("2026-11-20T16:02:50.000Z");
  });

  it("does not link the CallDetailsCustom Tri State pair, since their callers differ", async () => {
    const db = (await startTestMongo()).db;
    const start = readFixture("23-tristate-custom-start-9379024706.json");
    const processed = readFixture("24-tristate-custom-processed-4193573627.json");

    await ingestFixture(db, start.rawBody);
    await ingestFixture(db, processed.rawBody);

    const startEvent = await db.collection("call_events").findOne({ caller_number: "9379024706" });
    const processedEvent = await db.collection("call_events").findOne({ caller_number: "4193573627" });
    expect(startEvent?.linked_event_id).toBeNull();
    expect(processedEvent?.linked_event_id).toBeNull();
  });

  it("links a matching CallDetailsCustom start<->processed pair", async () => {
    const db = (await startTestMongo()).db;
    const start = readFixture("synthetic-custom-pair-start.json");
    const processed = readFixture("synthetic-custom-pair-processed.json");

    await ingestFixture(db, start.rawBody);
    await ingestFixture(db, processed.rawBody);

    const startEvent = await db.collection("call_events").findOne({ action: "CallDetailsCustom.CallStartCall", caller_number: "9995550199" });
    const processedEvent = await db.collection("call_events").findOne({ action: "CallDetailsCustom.CallProcessed", caller_number: "9995550199" });

    expect(startEvent?.linked_event_id).not.toBeNull();
    expect(processedEvent?.linked_event_id).not.toBeNull();
    expect(startEvent?.linked_event_id?.equals(processedEvent?._id)).toBe(true);
  });

  it("normalizes a website-click event and resolves its market via the tracking_numbers lookup", async () => {
    const db = (await startTestMongo()).db;

    // Seed the tracking_numbers lookup the same way production does: ingest a real
    // call to this tracking number first, so the click can resolve market from it.
    const call = readFixture("21-atlantic-custom-start-9542547114.json");
    await ingestFixture(db, call.rawBody);

    const click = readFixture("20-website-click-atlantic-8774557300.json");
    await ingestFixture(db, click.rawBody);

    const clickEvent = await db.collection("call_events").findOne({ action: "WebsiteEvent.Click" });
    expect(clickEvent).not.toBeNull();
    expect(clickEvent?.called_number).toBe("8774557300");
    expect(clickEvent?.market).toBe("Atlantic Mens");
    expect(clickEvent?.site).toBe("https://atlanticmensclinic.com");
    expect(clickEvent?.utm_source).toBe("google");
    expect((clickEvent?.start_utc as Date).toISOString()).toBe("2026-11-20T15:22:53.697Z");
  });

  it("still stores a website-click event when its tracking number has no prior market", async () => {
    const db = (await startTestMongo()).db;
    const click = readFixture("20-website-click-atlantic-8774557300.json");
    const { duplicate } = await ingestFixture(db, click.rawBody);
    expect(duplicate).toBe(false);

    const clickEvent = await db.collection("call_events").findOne({ action: "WebsiteEvent.Click" });
    expect(clickEvent?.market).toBeNull();
    expect(clickEvent?.caller_number).toBeNull();
  });
});
