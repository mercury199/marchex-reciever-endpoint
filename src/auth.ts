import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a).digest();
  const bufB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function registerAuthRoutes(app: FastifyInstance, config: Config): void {
  app.post<{ Body: { username?: string; password?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";

      if (
        username.length > 0 &&
        password.length > 0 &&
        constantTimeEqual(username, config.dashboardUser) &&
        constantTimeEqual(password, config.dashboardPassword)
      ) {
        request.session.set("authenticated", true);
        reply.send({ ok: true });
        return;
      }

      reply.code(401).send({ error: "invalid credentials" });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    request.session.delete();
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    reply.send({ authenticated: request.session.get("authenticated") === true });
  });
}

/** preHandler that gates every other /api/* route behind the dashboard session cookie. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.session.get("authenticated") !== true) {
    reply.code(401).send({ error: "unauthorized" });
  }
}
