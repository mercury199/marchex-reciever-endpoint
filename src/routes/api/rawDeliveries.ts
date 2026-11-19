import type { FastifyInstance } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { reprocessDelivery } from "../../ingest.js";

const QuerySchema = z.object({
  hasError: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export function registerRawDeliveryRoutes(app: FastifyInstance, db: Db): void {
  app.get("/raw-deliveries", async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query" });
      return;
    }
    const { hasError, page, pageSize } = parsed.data;
    const filter = hasError ? { parse_error: { $ne: null } } : {};

    const [rows, total] = await Promise.all([
      db
        .collection("raw_deliveries")
        .find(filter)
        .sort({ received_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      db.collection("raw_deliveries").countDocuments(filter),
    ]);

    reply.send({ rows, total, page, pageSize });
  });

  app.get<{ Params: { id: string } }>("/raw-deliveries/:id", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    const delivery = await db.collection("raw_deliveries").findOne({ _id: new ObjectId(request.params.id) });
    if (!delivery) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.send({ delivery });
  });

  app.post<{ Params: { id: string } }>("/raw-deliveries/:id/reprocess", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    try {
      await reprocessDelivery(db, new ObjectId(request.params.id));
      reply.send({ ok: true });
    } catch (err) {
      reply.code((err as Error).message === "raw delivery not found" ? 404 : 500).send({ error: (err as Error).message });
    }
  });
}
