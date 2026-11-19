import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import { flatten } from "./flatten.js";

/** Upserts field_catalog entries for every leaf path found in `data`. */
export async function recordFieldCatalog(db: Db, data: Record<string, unknown>): Promise<void> {
  const leaves = flatten(data);
  if (leaves.length === 0) return;

  const now = new Date();
  const ops: AnyBulkWriteOperation<Document>[] = leaves.map(({ path, type }) => ({
    updateOne: {
      filter: { path },
      update: {
        $addToSet: { types_seen: type },
        $min: { first_seen: now },
        $max: { last_seen: now },
        $inc: { count: 1 },
      },
      upsert: true,
    },
  }));

  await db.collection("field_catalog").bulkWrite(ops, { ordered: false });
}
