import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";
import { computeAttribution } from "../../lib/attribution.js";

const AttributionQuerySchema = z.object({
  windowSeconds: z.coerce.number().int().min(1).max(86400).optional().default(1800),
  // z.coerce.boolean() treats the literal string "false" as truthy, so the query
  // param is matched against the exact strings instead.
  requireSameNumber: z.enum(["true", "false"]).optional().default("false"),
  market: z.string().min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export function registerAttributionRoutes(app: FastifyInstance, db: Db): void {
  app.get("/attribution", async (request, reply) => {
    const parsed = AttributionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query", details: parsed.error.flatten() });
      return;
    }
    const query = parsed.data;
    const requireSameNumber = query.requireSameNumber === "true";

    const rows = await computeAttribution(db, {
      windowSeconds: query.windowSeconds,
      requireSameNumber,
      market: query.market,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });

    reply.send({ rows, windowSeconds: query.windowSeconds, requireSameNumber });
  });
}
