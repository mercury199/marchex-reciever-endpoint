import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "marchex");

const baseUrl = process.env.REPLAY_BASE_URL ?? "http://localhost:3000";
const token = process.env.WEBHOOK_TOKEN;

if (!token) {
  console.error("Set WEBHOOK_TOKEN to the same value the running server is using, then re-run.");
  process.exit(1);
}

const files = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let failures = 0;

for (const file of files) {
  const body = fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8");
  const response = await fetch(`${baseUrl}/webhooks/marchex/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const ok = response.status === 200;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK " : "FAIL"} ${response.status}  ${file}`);
}

console.log(`\nReplayed ${files.length} fixtures against ${baseUrl}, ${failures} failed.`);
if (failures > 0) process.exit(1);
