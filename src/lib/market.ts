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

/**
 * Self-filling lookup (mirrors `advertisers`) keyed by phone number instead of
 * advertiser ID: whenever a call event resolves a market and has a called_number,
 * record that pairing here. This is what lets a website-click event - which has no
 * AdvertiserDetails/OrgGroupName at all, only a tracking phone number - resolve to
 * the same market a real call to that number already resolved to.
 */
export async function recordTrackingNumberMarket(db: Db, trackingNumber: string, market: string): Promise<void> {
  await db.collection("tracking_numbers").updateOne(
    { _id: trackingNumber as unknown as never },
    { $set: { market, updated_at: new Date() } },
    { upsert: true },
  );
}

export async function resolveMarketByTrackingNumber(db: Db, trackingNumbers: (string | null)[]): Promise<string | null> {
  const candidates = trackingNumbers.filter((n): n is string => typeof n === "string" && n !== "");
  if (candidates.length === 0) return null;
  const found = await db.collection("tracking_numbers").findOne({ _id: { $in: candidates } as unknown as never });
  return found && typeof found.market === "string" ? found.market : null;
}
