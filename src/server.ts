import { loadConfig } from "./config.js";
import { connectDb } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { buildApp } from "./app.js";
import { seedForwardTargets } from "./lib/forwardTargets.js";
import { pollForwardJobs, type FetchLike } from "./lib/forwardQueue.js";

const FORWARD_POLL_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  // Fails fast with a clear error if any required env var is missing.
  const config = loadConfig();

  const db = await connectDb(config.mongoUrl);
  await bootstrapDatabase(db);
  await seedForwardTargets(db, config.forwardUrls);

  const app = await buildApp(db, config);

  const fetchImpl = fetch as unknown as FetchLike;
  setInterval(() => {
    pollForwardJobs(db, fetchImpl).catch((err: unknown) => {
      app.log.error({ err }, "pollForwardJobs failed unexpectedly");
    });
  }, FORWARD_POLL_INTERVAL_MS);

  await app.listen({ host: "0.0.0.0", port: config.port });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
