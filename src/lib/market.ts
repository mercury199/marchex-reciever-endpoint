import type { Db } from "mongodb";

export interface AdvertiserDetails {
  AdvertiserID?: number | null;
  AdvertiserName?: string | null;
  [key: string]: unknown;
}

/**
 * Resolves the "market" for an event, per docs/DESIGN.md §6:
 *   1. AdvertiserDetails.AdvertiserName if present/non-empty (and upserts the
 *      advertisers lookup for future CallStartCall-only resolution).
 *   2. Else look up AdvertiserID in the advertisers lookup.
 *   3. Else OrgGroupName with a literal trailing " - default" stripped.
 *   4. Else null.
 */
export async function resolveMarket(
  db: Db,
  advertiserDetails: AdvertiserDetails | null | undefined,
  orgGroupName: string | null | undefined,
): Promise<string | null> {
  const advertiserId = advertiserDetails?.AdvertiserID ?? null;
  const advertiserName = advertiserDetails?.AdvertiserName;

  if (typeof advertiserName === "string" && advertiserName.trim() !== "") {
    if (typeof advertiserId === "number") {
      await db.collection("advertisers").updateOne(
        { _id: advertiserId as unknown as never },
        {
          $set: {
            name: advertiserName,
            org_group: orgGroupName ?? null,
            updated_at: new Date(),
          },
        },
        { upsert: true },
      );
    }
    return advertiserName;
  }

  if (typeof advertiserId === "number") {
    const found = await db.collection("advertisers").findOne({ _id: advertiserId as unknown as never });
    if (found && typeof found.name === "string") {
      return found.name;
    }
  }

  if (typeof orgGroupName === "string" && orgGroupName.trim() !== "") {
    const suffix = " - default";
    return orgGroupName.endsWith(suffix)
      ? orgGroupName.slice(0, -suffix.length)
      : orgGroupName;
  }

  return null;
}
