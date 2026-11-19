import { afterEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import ExcelJS from "exceljs";
import { startTestMongo, type TestMongo } from "./helpers/mongo.js";
import { readFixture } from "./helpers/fixtures.js";
import { buildTestApp, loginAndGetCookie } from "./helpers/testApp.js";
import { ingestRawDelivery, processDelivery } from "../src/ingest.js";
import type { FastifyInstance } from "fastify";

async function ingestFixture(db: TestMongo["db"], name: string) {
  const fixture = readFixture(name);
  const { rawDeliveryId } = await ingestRawDelivery(db, {
    headers: {},
    contentType: "application/json",
    rawBody: fixture.rawBody,
  });
  await processDelivery(db, rawDeliveryId);
  return rawDeliveryId;
}

describe("API", () => {
  let mongo: TestMongo;
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    await mongo?.stop();
  });

  async function setup() {
    mongo = await startTestMongo();
    app = await buildTestApp(mongo.db);
    return { db: mongo.db, app };
  }

  it("rejects /api/calls without a session, and accepts it after login", async () => {
    const { app: a } = await setup();

    const unauthed = await a.inject({ method: "GET", url: "/api/calls" });
    expect(unauthed.statusCode).toBe(401);

    const badLogin = await a.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nope", password: "nope" },
    });
    expect(badLogin.statusCode).toBe(401);

    const cookie = await loginAndGetCookie(a);
    const authed = await a.inject({ method: "GET", url: "/api/calls", headers: { cookie } });
    expect(authed.statusCode).toBe(200);
  });

  it("filters, paginates, and sorts via the generic filter builder, and rejects unknown/unsafe paths", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);

    await ingestFixture(db, "15-heartland-processed-8167182325.json"); // DNC true
    await ingestFixture(db, "16-atlantic-processed-3053181246.json"); // DNC false
    await ingestFixture(db, "19-heartland-processed-9136261939.json"); // DNC true

    const dncTrue = await a.inject({
      method: "GET",
      url: `/api/calls?filters=${encodeURIComponent(JSON.stringify([{ path: "registered_dnc", operator: "equals", value: true }]))}`,
      headers: { cookie },
    });
    expect(dncTrue.statusCode).toBe(200);
    const dncBody = dncTrue.json() as { rows: unknown[]; total: number };
    expect(dncBody.total).toBe(2);

    const byMarket = await a.inject({ method: "GET", url: "/api/calls?market=Heartland", headers: { cookie } });
    expect((byMarket.json() as { total: number }).total).toBe(2);

    const paged = await a.inject({ method: "GET", url: "/api/calls?page=1&pageSize=1&sort=start_utc&dir=asc", headers: { cookie } });
    const pagedBody = paged.json() as { rows: unknown[]; total: number };
    expect(pagedBody.rows).toHaveLength(1);
    expect(pagedBody.total).toBe(3);

    const unknownPath = await a.inject({
      method: "GET",
      url: `/api/calls?filters=${encodeURIComponent(JSON.stringify([{ path: "NotARealField", operator: "equals", value: "x" }]))}`,
      headers: { cookie },
    });
    expect(unknownPath.statusCode).toBe(400);

    const dollarPath = await a.inject({
      method: "GET",
      url: `/api/calls?filters=${encodeURIComponent(JSON.stringify([{ path: "$where", operator: "equals", value: "x" }]))}`,
      headers: { cookie },
    });
    expect(dollarPath.statusCode).toBe(400);
  });

  it("returns a call's linked counterpart in the detail endpoint", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);

    await ingestFixture(db, "14-heartland-start-9136261939.json");
    await ingestFixture(db, "19-heartland-processed-9136261939.json");

    const startEvent = await db.collection("call_events").findOne({ caller_number: "9136261939", action: "CallDetails.CallStartCall" });
    const detail = await a.inject({ method: "GET", url: `/api/calls/${startEvent?._id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { event: { linked_event_id: string }; linked: { action: string } | null };
    expect(body.linked).not.toBeNull();
    expect(body.linked?.action).toBe("CallDetails.CallProcessed");
  });

  it("exports CSV with quoted phone numbers and registered_dnc always included", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);
    await ingestFixture(db, "08-atlantic-start-3053181246.json");

    const response = await a.inject({ method: "GET", url: "/api/export.csv?columns=caller_number,market", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");

    const lines = response.body.trim().split("\n");
    expect(lines[0]).toBe("caller_number,market,registered_dnc");
    expect(lines[1]).toContain('"3053181246"');
  });

  it("exports a readable XLSX workbook with the requested columns", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);
    await ingestFixture(db, "08-atlantic-start-3053181246.json");

    const response = await a.inject({ method: "GET", url: "/api/export.xlsx?columns=caller_number,market", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Calls");
    expect(sheet?.getRow(1).getCell(1).value).toBe("caller_number");
    expect(String(sheet?.getRow(2).getCell(1).value)).toBe("3053181246");
  });

  it("CRUDs forward_targets and retries a failed job via the API", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);

    const create = await a.inject({
      method: "POST",
      url: "/api/forward-targets",
      headers: { cookie },
      payload: { url: "https://example.com/hook" },
    });
    expect(create.statusCode).toBe(201);
    const { _id } = create.json() as { _id: string };

    const list = await a.inject({ method: "GET", url: "/api/forward-targets", headers: { cookie } });
    expect((list.json() as { targets: unknown[] }).targets).toHaveLength(1);

    const patch = await a.inject({ method: "PATCH", url: `/api/forward-targets/${_id}`, headers: { cookie }, payload: { enabled: false } });
    expect(patch.statusCode).toBe(200);

    const del = await a.inject({ method: "DELETE", url: `/api/forward-targets/${_id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    const jobResult = await db.collection("forward_jobs").insertOne({
      raw_delivery_id: new ObjectId(),
      target_id: new ObjectId(),
      status: "failed",
      attempts: 5,
      max_attempts: 5,
      next_attempt_at: new Date(),
      last_attempt_at: new Date(),
      last_status_code: 500,
      last_latency_ms: 10,
      last_response_body: "err",
      last_error: "err",
      created_at: new Date(),
    });
    const retry = await a.inject({ method: "POST", url: `/api/forward-jobs/${jobResult.insertedId}/retry`, headers: { cookie } });
    expect(retry.statusCode).toBe(200);
    const job = await db.collection("forward_jobs").findOne({ _id: jobResult.insertedId });
    expect(job?.status).toBe("pending");
  });

  it("lists raw_deliveries and reprocesses one without changing event count", async () => {
    const { db, app: a } = await setup();
    const cookie = await loginAndGetCookie(a);
    const rawDeliveryId = await ingestFixture(db, "09-northeast-processed-6614589677.json");

    const list = await a.inject({ method: "GET", url: "/api/raw-deliveries", headers: { cookie } });
    expect((list.json() as { total: number }).total).toBe(1);

    const beforeCount = await db.collection("call_events").countDocuments({ raw_delivery_id: rawDeliveryId });
    const reprocess = await a.inject({ method: "POST", url: `/api/raw-deliveries/${rawDeliveryId}/reprocess`, headers: { cookie } });
    expect(reprocess.statusCode).toBe(200);
    const afterCount = await db.collection("call_events").countDocuments({ raw_delivery_id: rawDeliveryId });
    expect(afterCount).toBe(beforeCount);
  });
});
