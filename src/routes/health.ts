import type { FastifyInstance } from "fastify";
import { pingDb } from "../db/client.js";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    const mongoOk = await pingDb();
    const body = {
      status: mongoOk ? "ok" : "degraded",
      mongo: mongoOk ? "ok" : "unreachable",
      timestamp: new Date().toISOString(),
    };
    reply.code(mongoOk ? 200 : 503).send(body);
  });
}
