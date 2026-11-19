import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "..", "fixtures", "marchex");

export interface Fixture {
  name: string;
  rawBody: string;
}

export function listFixtures(): Fixture[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      rawBody: fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"),
    }));
}

export function readFixture(name: string): Fixture {
  return {
    name,
    rawBody: fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"),
  };
}
