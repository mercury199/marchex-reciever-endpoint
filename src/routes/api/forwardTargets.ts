import type { FastifyInstance } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { retryForwardJob } from "../../lib/forwardQueue.js";

const TargetSchema = z.object({
  url: z.string().url(),
  enabled: z.boolean().optional().default(true),
  action_filter: z.string().nullable().optional().default(null),
  market_filter: z.string().nullable().optional().default(null),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

const TargetUpdateSchema = TargetSchema.partial();

export function registerForwardTargetRoutes(app: FastifyInstance, db: Db): void {
  const targets = () => db.collection("forward_targets");
  const jobs = () => db.collection("forward_jobs");

  app.get("/forward-targets", async (_request, reply) => {
    reply.send({ targets: await targets().find({}).sort({ created_at: -1 }).toArray() });
  });

  app.post("/forward-targets", async (request, reply) => {
    const parsed = TargetSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid target", details: parsed.error.flatten() });
      return;
    }
    const now = new Date();
    const result = await targets().insertOne({ ...parsed.data, created_at: now, updated_at: now });
    reply.code(201).send({ _id: result.insertedId });
  });

  app.patch<{ Params: { id: string } }>("/forward-targets/:id", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    const parsed = TargetUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid target", details: parsed.error.flatten() });
      return;
    }
    const result = await targets().updateOne(
      { _id: new ObjectId(request.params.id) },
      { $set: { ...parsed.data, updated_at: new Date() } },
    );
    if (result.matchedCount === 0) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/forward-targets/:id", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    const result = await targets().deleteOne({ _id: new ObjectId(request.params.id) });
    if (result.deletedCount === 0) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.get("/forward-jobs", async (request, reply) => {
    const QuerySchema = z.object({
      status: z.enum(["pending", "in_progress", "succeeded", "failed"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    });
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid query" });
      return;
    }
    const filter = parsed.data.status ? { status: parsed.data.status } : {};
    const results = await jobs()
      .find(filter)
      .sort({ last_attempt_at: -1, created_at: -1 })
      .limit(parsed.data.limit)
      .toArray();
    reply.send({ jobs: results });
  });

  app.post<{ Params: { id: string } }>("/forward-jobs/:id/retry", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    const retried = await retryForwardJob(db, new ObjectId(request.params.id));
    if (!retried) {
      reply.code(409).send({ error: "job is not in a failed state, or does not exist" });
      return;
    }
    reply.send({ ok: true });
  });
}
