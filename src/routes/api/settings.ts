import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";

const ATTRIBUTION_SETTINGS_ID = "attribution";

const DEFAULT_ATTRIBUTION_SETTINGS = {
  windowSeconds: 1800,
  requireSameNumber: false,
};

const AttributionSettingsSchema = z.object({
  windowSeconds: z.number().int().min(1).max(86400),
  requireSameNumber: z.boolean(),
});

/**
 * Small per-feature settings store (one document per feature, keyed by a fixed
 * _id) - just enough to persist the Attribution tab's default window/toggle
 * across dashboard sessions, without a dedicated collection per setting.
 */
export function registerSettingsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/settings/attribution", async (_request, reply) => {
    const doc = await db.collection("settings").findOne({ _id: ATTRIBUTION_SETTINGS_ID as unknown as never });
    reply.send({
      windowSeconds: typeof doc?.windowSeconds === "number" ? doc.windowSeconds : DEFAULT_ATTRIBUTION_SETTINGS.windowSeconds,
      requireSameNumber: typeof doc?.requireSameNumber === "boolean" ? doc.requireSameNumber : DEFAULT_ATTRIBUTION_SETTINGS.requireSameNumber,
    });
  });

  app.put("/settings/attribution", async (request, reply) => {
    const parsed = AttributionSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid settings", details: parsed.error.flatten() });
      return;
    }
    await db.collection("settings").updateOne(
      { _id: ATTRIBUTION_SETTINGS_ID as unknown as never },
      { $set: { ...parsed.data, updated_at: new Date() } },
      { upsert: true },
    );
    reply.send({ ok: true, ...parsed.data });
  });
}
