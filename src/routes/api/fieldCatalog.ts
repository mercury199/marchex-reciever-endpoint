import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";

export function registerFieldCatalogRoutes(app: FastifyInstance, db: Db): void {
  app.get("/field-catalog", async (_request, reply) => {
    const entries = await db.collection("field_catalog").find({}).sort({ path: 1 }).toArray();
    reply.send({ entries });
  });

  app.get("/markets", async (_request, reply) => {
    const markets = await db.collection("call_events").distinct("market", { market: { $ne: null } });
    reply.send({ markets: (markets as (string | null)[]).filter((m): m is string => m !== null).sort() });
  });
}
