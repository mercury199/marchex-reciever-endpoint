import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import secureSession from "@fastify/secure-session";
import staticPlugin from "@fastify/static";
import type { Db } from "mongodb";
import type { Config } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerWebhookRoute } from "./routes/webhook.js";
import { registerAuthRoutes, requireAuth } from "./auth.js";
import { registerCallsRoutes } from "./routes/api/calls.js";
import { registerFieldCatalogRoutes } from "./routes/api/fieldCatalog.js";
import { registerExportRoutes } from "./routes/api/export.js";
import { registerForwardTargetRoutes } from "./routes/api/forwardTargets.js";
import { registerRawDeliveryRoutes } from "./routes/api/rawDeliveries.js";
import { registerAttributionRoutes } from "./routes/api/attribution.js";
import { registerSettingsRoutes } from "./routes/api/settings.js";

export async function buildApp(db: Db, config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie);
  await app.register(secureSession, {
    key: crypto.createHash("sha256").update(config.sessionSecret).digest(),
    cookieName: "marchex_session",
    cookie: { path: "/", httpOnly: true, sameSite: "lax" },
  });

  // Webhook route lives in its own encapsulated plugin so its raw-body content-type
  // parser (which must accept malformed/non-JSON bodies) never affects /api/* routes,
  // which should keep Fastify's normal JSON body parsing.
  await app.register(async (webhookScope) => {
    // Fastify's built-in exact-match "application/json" parser otherwise takes
    // priority over a wildcard parser for that exact content-type, which is
    // precisely what Marchex sends - so it must be removed first, not just
    // shadowed, or the webhook body comes through already (and silently) parsed.
    webhookScope.removeAllContentTypeParsers();
    webhookScope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });
    registerWebhookRoute(webhookScope, db, config.webhookToken);
  });

  registerHealthRoute(app);
  registerAuthRoutes(app, config);

  await app.register(
    async (api) => {
      api.addHook("preHandler", requireAuth);
      registerCallsRoutes(api, db);
      registerFieldCatalogRoutes(api, db);
      registerExportRoutes(api, db);
      registerForwardTargetRoutes(api, db);
      registerRawDeliveryRoutes(api, db);
      registerAttributionRoutes(api, db);
      registerSettingsRoutes(api, db);
    },
    { prefix: "/api" },
  );

  // Serve the built dashboard (web/dist -> dist/public) from the same process.
  // Static assets and the SPA shell are necessarily reachable unauthenticated -
  // that's what renders the login form - but every data route above stays behind
  // requireAuth, and the webhook stays on its own path.
  const publicDir = path.join(process.cwd(), "dist", "public");
  if (fs.existsSync(publicDir)) {
    await app.register(staticPlugin, { root: publicDir });

    app.setNotFoundHandler((request, reply) => {
      const isApiLike =
        request.url.startsWith("/api") || request.url.startsWith("/webhooks") || request.url.startsWith("/health");
      if (request.method === "GET" && !isApiLike) {
        reply.sendFile("index.html");
        return;
      }
      reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
