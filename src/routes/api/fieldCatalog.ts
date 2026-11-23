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

  /** Distinct values for the dropdown filters on Calls/Attribution/Dashboard. */
  app.get("/filter-options", async (_request, reply) => {
    const callEvents = db.collection("call_events");
    const nonEmpty = (field: string) => ({ [field]: { $nin: [null, ""] } });
    const [utmSources, adNames, channels] = await Promise.all([
      callEvents.distinct("utm_source", nonEmpty("utm_source")),
      callEvents.distinct("ad_name", nonEmpty("ad_name")),
      callEvents.distinct("channel", nonEmpty("channel")),
    ]);
    reply.send({
      utmSources: (utmSources as string[]).sort(),
      adNames: (adNames as string[]).sort(),
      channels: (channels as string[]).sort(),
    });
  });
}
