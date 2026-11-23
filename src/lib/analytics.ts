import type { Db, Document, Filter } from "mongodb";

export interface CommonAnalyticsFilters {
  market?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function baseMatch(filters: CommonAnalyticsFilters): Filter<Document> {
  const match: Filter<Document> = {};
  if (filters.market) match.market = filters.market;
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.$gte = filters.dateFrom;
    if (filters.dateTo) range.$lte = filters.dateTo;
    match.start_utc = range;
  }
  return match;
}

const CALL_ACTIONS = [
  "CallDetails.CallStartCall",
  "CallDetails.CallProcessed",
  "CallDetailsCustom.CallStartCall",
  "CallDetailsCustom.CallProcessed",
];

export interface NumberBreakdownRow {
  calledNumber: string;
  market: string | null;
  adName: string | null;
  totalCalls: number;
  avgCallSeconds: number | null;
  answeredCalls: number;
  answeredPercent: number | null;
  hourlyCounts: number[];
  peakHour: number | null;
}

/**
 * One row per target (tracking) phone number actually dialed - website-click
 * events are deliberately excluded (a click isn't a call), so `called_number`
 * here always means a real CallStartCall/CallProcessed destination. `hours` is
 * collected as a raw array rather than pre-bucketed in the pipeline so the
 * 24-slot histogram (and peak hour) can be built in one cheap pass in JS.
 */
export async function computeNumberBreakdown(db: Db, filters: CommonAnalyticsFilters): Promise<NumberBreakdownRow[]> {
  const match: Filter<Document> = {
    ...baseMatch(filters),
    action: { $in: CALL_ACTIONS },
    called_number: { $ne: null },
  };

  const docs = await db
    .collection("call_events")
    .aggregate([
      { $match: match },
      { $sort: { start_utc: 1 } },
      {
        $group: {
          _id: "$called_number",
          market: { $last: "$market" },
          ad_name: { $last: "$ad_name" },
          total_calls: { $sum: 1 },
          avg_call_seconds: { $avg: "$call_seconds" },
          answered_calls: {
            $sum: { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$answer_status", ""] } }, "answered"] }, 1, 0] },
          },
          hours: { $push: { $hour: { date: "$start_utc", timezone: "UTC" } } },
        },
      },
      { $sort: { total_calls: -1 } },
    ])
    .toArray();

  return docs.map((doc) => {
    const hourlyCounts = new Array(24).fill(0) as number[];
    for (const hour of doc.hours as (number | null)[]) {
      if (typeof hour === "number" && hour >= 0 && hour < 24) hourlyCounts[hour] = (hourlyCounts[hour] ?? 0) + 1;
    }
    const peakHour = hourlyCounts.some((c) => c > 0) ? hourlyCounts.indexOf(Math.max(...hourlyCounts)) : null;

    return {
      calledNumber: doc._id as string,
      market: (doc.market as string | null) ?? null,
      adName: (doc.ad_name as string | null) ?? null,
      totalCalls: doc.total_calls as number,
      avgCallSeconds: typeof doc.avg_call_seconds === "number" ? doc.avg_call_seconds : null,
      answeredCalls: doc.answered_calls as number,
      answeredPercent: doc.total_calls > 0 ? (doc.answered_calls / doc.total_calls) * 100 : null,
      hourlyCounts,
      peakHour,
    };
  });
}

export interface DashboardFilters extends CommonAnalyticsFilters {
  channel?: string;
  utmSource?: string;
  adName?: string;
  action?: string;
  paid?: boolean;
  registeredDnc?: boolean;
}

interface CountRow {
  _id: string | boolean | null;
  count: number;
}

export interface DashboardStats {
  totalEvents: number;
  totalCalls: number;
  totalClicks: number;
  linking: { total: number; linked: number; percentage: number | null };
  byMarket: { market: string; count: number }[];
  byAction: { action: string; count: number }[];
  byDay: { date: string; count: number }[];
  byHour: number[];
  byChannel: { channel: string; count: number }[];
  callLength: { avgSeconds: number | null; maxSeconds: number | null; count: number };
  answerStatus: { status: string; count: number }[];
  paidBreakdown: { paid: boolean; count: number }[];
  dncBreakdown: { registeredDnc: boolean; count: number }[];
}

/**
 * One aggregate() round trip ($facet) computing every stat the Dashboard tab
 * shows, over the same filtered set of call_events. "Linking %" is defined
 * over events that COULD link (non-null call_key - i.e. every CallStartCall/
 * CallProcessed event, legacy or custom family) and are actually linked;
 * website-click events have no call_key and are correctly excluded from that
 * ratio, not counted as a failure to link.
 */
export async function computeDashboardStats(db: Db, filters: DashboardFilters): Promise<DashboardStats> {
  const match: Filter<Document> = { ...baseMatch(filters) };
  if (filters.channel) match.channel = filters.channel;
  if (filters.utmSource) match.utm_source = filters.utmSource;
  if (filters.action) match.action = filters.action;
  if (filters.adName) match.ad_name = filters.adName;
  if (typeof filters.paid === "boolean") match.paid = filters.paid;
  if (typeof filters.registeredDnc === "boolean") match.registered_dnc = filters.registeredDnc;

  const results = await db
    .collection("call_events")
    .aggregate([
      { $match: match },
      {
        $facet: {
          byAction: [{ $group: { _id: "$action", count: { $sum: 1 } } }],
          byMarket: [
            { $match: { market: { $nin: [null, ""] } } },
            { $group: { _id: "$market", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byDay: [
            { $match: { start_utc: { $ne: null } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$start_utc", timezone: "UTC" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byHour: [
            { $match: { start_utc: { $ne: null } } },
            { $group: { _id: { $hour: { date: "$start_utc", timezone: "UTC" } }, count: { $sum: 1 } } },
          ],
          byChannel: [
            { $match: { channel: { $nin: [null, ""] } } },
            { $group: { _id: "$channel", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          callLength: [
            { $match: { call_seconds: { $ne: null } } },
            { $group: { _id: null, avg: { $avg: "$call_seconds" }, max: { $max: "$call_seconds" }, count: { $sum: 1 } } },
          ],
          answerStatus: [
            { $match: { answer_status: { $nin: [null, ""] } } },
            { $group: { _id: { $toLower: "$answer_status" }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          paidBreakdown: [
            { $match: { paid: { $ne: null } } },
            { $group: { _id: "$paid", count: { $sum: 1 } } },
          ],
          dncBreakdown: [
            { $match: { registered_dnc: { $ne: null } } },
            { $group: { _id: "$registered_dnc", count: { $sum: 1 } } },
          ],
          linking: [
            { $match: { call_key: { $ne: null } } },
            { $group: { _id: null, total: { $sum: 1 }, linked: { $sum: { $cond: [{ $ne: ["$linked_event_id", null] }, 1, 0] } } } },
          ],
        },
      },
    ])
    .toArray();

  // $facet always yields exactly one output document, even over an empty
  // collection (each facet's own pipeline just produces an empty array).
  const facets = (results[0] ?? {}) as {
    byAction?: CountRow[];
    byMarket?: CountRow[];
    byDay?: CountRow[];
    byHour?: CountRow[];
    byChannel?: CountRow[];
    callLength?: { avg: number | null; max: number | null; count: number }[];
    answerStatus?: CountRow[];
    paidBreakdown?: CountRow[];
    dncBreakdown?: CountRow[];
    linking?: { total: number; linked: number }[];
  };

  const byAction = (facets.byAction ?? []).map((r) => ({ action: String(r._id ?? "unknown"), count: r.count }));
  const totalEvents = byAction.reduce((sum, r) => sum + r.count, 0);
  const totalClicks = byAction.find((r) => r.action === "WebsiteEvent.Click")?.count ?? 0;
  const totalCalls = totalEvents - totalClicks;

  const byHourMap = new Map<number, number>((facets.byHour ?? []).map((r) => [Number(r._id), r.count]));
  const byHour = Array.from({ length: 24 }, (_, hour) => byHourMap.get(hour) ?? 0);

  const linkingRow = (facets.linking ?? [])[0];
  const linkingTotal = linkingRow?.total ?? 0;
  const linkingLinked = linkingRow?.linked ?? 0;

  const callLengthRow = (facets.callLength ?? [])[0];

  return {
    totalEvents,
    totalCalls,
    totalClicks,
    linking: {
      total: linkingTotal,
      linked: linkingLinked,
      percentage: linkingTotal > 0 ? (linkingLinked / linkingTotal) * 100 : null,
    },
    byMarket: (facets.byMarket ?? []).map((r) => ({ market: String(r._id), count: r.count })),
    byAction,
    byDay: (facets.byDay ?? []).map((r) => ({ date: String(r._id), count: r.count })),
    byHour,
    byChannel: (facets.byChannel ?? []).map((r) => ({ channel: String(r._id), count: r.count })),
    callLength: {
      avgSeconds: callLengthRow?.avg ?? null,
      maxSeconds: callLengthRow?.max ?? null,
      count: callLengthRow?.count ?? 0,
    },
    answerStatus: (facets.answerStatus ?? []).map((r) => ({ status: String(r._id), count: r.count })),
    paidBreakdown: (facets.paidBreakdown ?? []).map((r) => ({ paid: Boolean(r._id), count: r.count })),
    dncBreakdown: (facets.dncBreakdown ?? []).map((r) => ({ registeredDnc: Boolean(r._id), count: r.count })),
  };
}
