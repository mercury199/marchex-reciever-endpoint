import type { Db } from "mongodb";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";

export const TEST_CONFIG: Config = {
  mongoUrl: "unused-in-tests",
  port: 0,
  webhookToken: "test-webhook-token",
  dashboardUser: "testuser",
  dashboardPassword: "testpassword",
  sessionSecret: "test-session-secret-at-least-32-bytes-long",
  forwardUrls: [],
};

export async function buildTestApp(db: Db): Promise<FastifyInstance> {
  const app = await buildApp(db, TEST_CONFIG);
  await app.ready();
  return app;
}

/** Logs in and returns the session cookie header value to reuse on subsequent requests. */
export async function loginAndGetCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: TEST_CONFIG.dashboardUser, password: TEST_CONFIG.dashboardPassword },
  });
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error("login did not set a session cookie");
  return cookieHeader.split(";")[0] ?? "";
}
