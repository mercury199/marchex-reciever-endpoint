import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";
import { computeAttribution, type AttributionOptions } from "../../lib/attribution.js";
import { csvEscape, csvPhoneCell } from "../../lib/csv.js";

const AttributionQuerySchema = z.object({
  windowSeconds: z.coerce.number().int().min(1).max(86400).optional().default(1800),
  // z.coerce.boolean() treats the literal string "false" as truthy, so the query
  // param is matched against the exact strings instead.
  requireSameNumber: z.enum(["true", "false"]).optional().default("false"),
  market: z.string().min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  utmSource: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  adName: z.string().min(1).optional(),
  excelTab: z.enum(["true", "false"]).optional().default("false"),
});

function toAttributionOptions(query: z.infer<typeof AttributionQuerySchema>): AttributionOptions {
  return {
    windowSeconds: query.windowSeconds,
    requireSameNumber: query.requireSameNumber === "true",
    market: query.market,
    dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
    dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    utmSource: query.utmSource,
    channel: query.channel,
    adName: query.adName,
  };
}

export function registerAttributionRoutes(app: FastifyInstance, db: Db): void {
  app.get("/attribution", async (request, reply) => {
    const parsed = AttributionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query", details: parsed.error.flatten() });
      return;
    }
    const query = parsed.data;
    const rows = await computeAttribution(db, toAttributionOptions(query));

    reply.send({ rows, windowSeconds: query.windowSeconds, requireSameNumber: query.requireSameNumber === "true" });
  });

  const EXPORT_COLUMNS = [
    "click_start_utc",
    "site",
    "market",
    "utm_source",
    "tracking_number",
    "matched_action",
    "call_start_utc",
    "caller_number",
    "delta_seconds",
  ] as const;

  const PHONE_COLUMNS = new Set(["caller_number"]);

  /**
   * Exports only the matched pairs ("a linked group") - unmatched clicks are left
   * out, since there's no call to report alongside them. Computed the same way as
   * GET /attribution; small enough (bounded by click count, not call volume) to
   * build in memory rather than stream from a cursor like /export.csv does.
   */
  app.get("/attribution/export.csv", async (request, reply) => {
    const parsed = AttributionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query", details: parsed.error.flatten() });
      return;
    }
    const query = parsed.data;
    const excelTab = query.excelTab === "true";

    const rows = await computeAttribution(db, toAttributionOptions(query));

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="attribution-linked.csv"',
    });
    reply.raw.write(`${EXPORT_COLUMNS.map(csvEscape).join(",")}\n`);
    for (const row of rows) {
      if (!row.call) continue;
      const values: Record<(typeof EXPORT_COLUMNS)[number], unknown> = {
        click_start_utc: row.click.start_utc,
        site: row.click.site,
        market: row.click.market,
        utm_source: row.click.utm_source,
        tracking_number: row.click.called_number,
        matched_action: row.call.action,
        call_start_utc: row.call.start_utc,
        caller_number: row.call.caller_number,
        delta_seconds: row.deltaSeconds,
      };
      const cells = EXPORT_COLUMNS.map((col) => (PHONE_COLUMNS.has(col) ? csvPhoneCell(values[col], excelTab) : csvEscape(values[col])));
      reply.raw.write(`${cells.join(",")}\n`);
    }
    reply.raw.end();
  });
}
