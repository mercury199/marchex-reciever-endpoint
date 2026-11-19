const REQUIRED_VARS = [
  "MONGO_URL",
  "WEBHOOK_TOKEN",
  "DASHBOARD_USER",
  "DASHBOARD_PASSWORD",
  "SESSION_SECRET",
] as const;

export interface Config {
  mongoUrl: string;
  port: number;
  webhookToken: string;
  dashboardUser: string;
  dashboardPassword: string;
  sessionSecret: string;
  forwardUrls: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED_VARS.filter((key) => !env[key] || env[key]?.trim() === "");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set them before starting the server (see .env.example).",
    );
  }

  return {
    mongoUrl: env.MONGO_URL!,
    port: env.PORT ? Number(env.PORT) : 3000,
    webhookToken: env.WEBHOOK_TOKEN!,
    dashboardUser: env.DASHBOARD_USER!,
    dashboardPassword: env.DASHBOARD_PASSWORD!,
    sessionSecret: env.SESSION_SECRET!,
    forwardUrls: (env.FORWARD_URLS ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0),
  };
}
