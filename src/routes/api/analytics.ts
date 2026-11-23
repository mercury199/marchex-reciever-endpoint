import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";
import { computeNumberBreakdown, computeDashboardStats } from "../../lib/analytics.js";

const NumbersQuerySchema = z.object({
  market: z.string().min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const DashboardQuerySchema = NumbersQuerySchema.extend({
  channel: z.string().min(1).optional(),
  paid: z.enum(["true", "false"]).optional(),
  registeredDnc: z.enum(["true", "false"]).optional(),
});

export function registerAnalyticsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/analytics/numbers", async (request, reply) => {
    const parsed = NumbersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query", details: parsed.error.flatten() });
      return;
    }
    const query = parsed.data;
    const rows = await computeNumberBreakdown(db, {
      market: query.market,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
    reply.send({ rows });
  });

  app.get("/analytics/dashboard", async (request, reply) => {
    const parsed = DashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query", details: parsed.error.flatten() });
      return;
    }
    const query = parsed.data;
    const stats = await computeDashboardStats(db, {
      market: query.market,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      channel: query.channel,
      paid: query.paid === undefined ? undefined : query.paid === "true",
      registeredDnc: query.registeredDnc === undefined ? undefined : query.registeredDnc === "true",
    });
    reply.send(stats);
  });
}
