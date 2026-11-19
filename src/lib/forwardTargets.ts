import type { Db } from "mongodb";

export interface ForwardTarget {
  url: string;
  enabled: boolean;
  action_filter: string | null;
  market_filter: string | null;
  headers: Record<string, string>;
}

/** Idempotent: inserts a target for each URL only if one with that exact url doesn't exist yet. */
export async function seedForwardTargets(db: Db, urls: string[]): Promise<void> {
  const targets = db.collection("forward_targets");
  const now = new Date();

  for (const url of urls) {
    await targets.updateOne(
      { url },
      {
        $setOnInsert: {
          url,
          enabled: true,
          action_filter: null,
          market_filter: null,
          headers: {},
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
  }
}
