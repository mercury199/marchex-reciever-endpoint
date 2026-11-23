import type { Db, Filter, Document, WithId } from "mongodb";

const CLICK_ACTION = "WebsiteEvent.Click";
const START_ACTIONS = ["CallDetails.CallStartCall", "CallDetailsCustom.CallStartCall"];

export { START_ACTIONS as ATTRIBUTION_START_ACTIONS };

export interface AttributionOptions {
  /** How far after a click a call may start and still count as a match. */
  windowSeconds: number;
  /** When true, only a call whose called_number equals the click's tracking number matches. */
  requireSameNumber: boolean;
  market?: string;
  dateFrom?: Date;
  dateTo?: Date;
  /** Filters the CLICK side: the utm_source that drove the click. */
  utmSource?: string;
  /** Filters the CALL side: the matched call's channel/ad_name/action. */
  channel?: string;
  adName?: string;
  /** Restricts which start-action type counts as a candidate; must be one of START_ACTIONS. */
  action?: string;
}

export interface AttributionRow {
  click: WithId<Document>;
  call: WithId<Document> | null;
  deltaSeconds: number | null;
}

/**
 * Best-estimate linking of website-click events to the CallStartCall that likely
 * followed them: never stored, always recomputed from the current filters. A call
 * matches a click only if it's in the SAME market (required, not optional - a click
 * on the Atlantic site can never attribute to a Tri State call) and started within
 * `windowSeconds` after the click; the nearest such call wins. `requireSameNumber`
 * additionally requires the call's called_number to equal the click's tracking
 * number, for callers who want the stricter same-number-only interpretation instead
 * of "any call into this market shortly after this click".
 */
export async function computeAttribution(db: Db, options: AttributionOptions): Promise<AttributionRow[]> {
  const callEvents = db.collection("call_events");

  const clickFilter: Filter<Document> = { action: CLICK_ACTION };
  if (options.market) clickFilter.market = options.market;
  if (options.utmSource) clickFilter.utm_source = options.utmSource;
  if (options.dateFrom || options.dateTo) {
    const range: Record<string, Date> = {};
    if (options.dateFrom) range.$gte = options.dateFrom;
    if (options.dateTo) range.$lte = options.dateTo;
    clickFilter.start_utc = range;
  }

  const clicks = await callEvents.find(clickFilter).sort({ start_utc: -1 }).toArray();
  const windowMs = options.windowSeconds * 1000;

  const rows: AttributionRow[] = [];
  for (const click of clicks) {
    const clickStart = click.start_utc as Date | null;
    if (!clickStart) {
      rows.push({ click, call: null, deltaSeconds: null });
      continue;
    }

    const clickInstant = clickStart.getTime();
    const candidateActions = options.action && START_ACTIONS.includes(options.action) ? [options.action] : START_ACTIONS;
    const callFilter: Filter<Document> = {
      action: { $in: candidateActions },
      start_utc: { $gte: new Date(clickInstant), $lte: new Date(clickInstant + windowMs) },
      // Same market is a hard requirement, not a tiebreaker - never matched when the
      // click's market is unresolved, since that would mean matching every market.
      market: click.market ?? null,
    };
    if (options.requireSameNumber) callFilter.called_number = click.called_number ?? null;
    if (options.channel) callFilter.channel = options.channel;
    if (options.adName) callFilter.ad_name = options.adName;

    const candidates = await callEvents.find(callFilter).toArray();
    let best: WithId<Document> | null = null;
    let bestDelta = Infinity;
    for (const candidate of candidates) {
      const candidateStart = candidate.start_utc as Date | null;
      if (!candidateStart) continue;
      const delta = candidateStart.getTime() - clickInstant;
      if (delta >= 0 && delta <= windowMs && delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }

    rows.push({ click, call: best, deltaSeconds: best ? bestDelta / 1000 : null });
  }

  return rows;
}
