import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { ingestRawDelivery, processDelivery } from "../ingest.js";

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(crypto.createHash("sha256").update(a).digest());
  const bufB = Buffer.from(crypto.createHash("sha256").update(b).digest());
  return crypto.timingSafeEqual(bufA, bufB);
}

export function registerWebhookRoute(app: FastifyInstance, db: Db, webhookToken: string): void {
  app.post<{ Params: { token: string }; Body: string }>(
    "/webhooks/marchex/:token",
    async (request, reply) => {
      if (!constantTimeEqual(request.params.token, webhookToken)) {
        reply.code(404).send();
        return;
      }

      const rawBody = typeof request.body === "string" ? request.body : "";
      const { rawDeliveryId } = await ingestRawDelivery(db, {
        headers: request.headers as Record<string, string>,
        contentType: request.headers["content-type"] ?? null,
        rawBody,
      });

      reply.code(200).send({ ok: true });

      processDelivery(db, rawDeliveryId).catch((err: unknown) => {
        request.log.error({ err, rawDeliveryId }, "processDelivery failed unexpectedly");
      });
    },
  );
}
