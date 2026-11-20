import type { Db } from "mongodb";
import { resolveMarket, recordTrackingNumberMarket, resolveMarketByTrackingNumber } from "./market.js";
import { toIanaZone, zonedLocalStringToUtc, utcStringToDate } from "./timezone.js";
import { isWebsiteClickShape } from "./payloadShape.js";

export interface NormalizedFields {
  action: string | null;
  market: string | null;
  advertiser_id: number | null;
  caller_number: string | null;
  called_number: string | null;
  study_id: number | null;
  ad_name: string | null;
  telmetrics_id: number | null;
  answer_status: string | null;
  call_seconds: number | null;
  registered_dnc: boolean | null;
  channel: string | null;
  paid: boolean | null;
  org_group: string | null;
  timezone: string | null;
  start_utc: Date | null;
  end_utc: Date | null;
  answer_utc: Date | null;
  monitor_start_utc: Date | null;
  monitor_end_utc: Date | null;
  call_key: string | null;
  // Website-click fields (null for every other action family).
  site: string | null;
  landing_page: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** "true"/"false" strings, as sent by the CallDetailsCustom family's attribution block. */
function boolString(value: unknown): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return bool(value);
}

const BLANK: Omit<NormalizedFields, "action"> = {
  market: null,
  advertiser_id: null,
  caller_number: null,
  called_number: null,
  study_id: null,
  ad_name: null,
  telmetrics_id: null,
  answer_status: null,
  call_seconds: null,
  registered_dnc: null,
  channel: null,
  paid: null,
  org_group: null,
  timezone: null,
  start_utc: null,
  end_utc: null,
  answer_utc: null,
  monitor_start_utc: null,
  monitor_end_utc: null,
  call_key: null,
  site: null,
  landing_page: null,
  referrer: null,
  utm_source: null,
  utm_campaign: null,
};

/**
 * The original Marchex shape: Action is "CallDetails.CallStartCall" /
 * "CallDetails.CallProcessed" (or any other CallDetails.* value), with
 * AdvertiserDetails/StudyDetails/MarketingAttribution siblings of Action.
 */
async function normalizeLegacyCall(db: Db, data: Record<string, unknown>, action: string | null): Promise<NormalizedFields> {
  const adDetails = (data.AdDetails ?? null) as Record<string, unknown> | null;
  const advertiserDetails = (data.AdvertiserDetails ?? null) as Record<string, unknown> | null;
  const studyDetails = (data.StudyDetails ?? null) as Record<string, unknown> | null;
  const marketingAttribution = (data.MarketingAttribution ?? null) as Record<string, unknown> | null;

  const orgGroupName = str(data.OrgGroupName);
  const market = await resolveMarket(
    db,
    advertiserDetails as { AdvertiserID?: number | null; AdvertiserName?: string | null } | null,
    orgGroupName,
  );

  const timeZoneName = str(data.TimeZone);
  const timezone = toIanaZone(timeZoneName);

  const callerNumber = str(data.CallerNumber);
  const calledNumber = str(data.CalledNumber);

  const studyId = num(data.StudyID) ?? num(studyDetails?.StudyID);
  const adName = str(data.AdDefinitionName) ?? str(adDetails?.AdDefinitionName) ?? str(studyDetails?.StudyName);

  // CallStartCall: CallDate is already UTC. CallProcessed: StartTime is local wall-clock.
  const startUtc = utcStringToDate(str(data.CallDate)) ?? zonedLocalStringToUtc(str(data.StartTime), timezone);
  const endUtc = zonedLocalStringToUtc(str(data.EndTime), timezone);
  const answerUtc = zonedLocalStringToUtc(str(data.AnswerTime), timezone);
  const monitorStartUtc = utcStringToDate(str(data.MonitorStartTime));
  const monitorEndUtc = utcStringToDate(str(data.MonitorEndTime));

  const callKey =
    calledNumber && callerNumber && studyId !== null ? `${calledNumber}|${callerNumber}|${studyId}` : null;

  if (market && calledNumber) await recordTrackingNumberMarket(db, calledNumber, market);

  return {
    ...BLANK,
    action,
    market,
    advertiser_id: num(advertiserDetails?.AdvertiserID),
    caller_number: callerNumber,
    called_number: calledNumber,
    study_id: studyId,
    ad_name: adName,
    telmetrics_id: num(data.TelmetricsId),
    answer_status: str(data.AnswerStatus),
    call_seconds: num(data.CallSeconds),
    registered_dnc: bool(data.RegisteredDNC),
    channel: str(marketingAttribution?.Channel),
    paid: bool(marketingAttribution?.Paid),
    org_group: orgGroupName,
    timezone,
    start_utc: startUtc,
    end_utc: endUtc,
    answer_utc: answerUtc,
    monitor_start_utc: monitorStartUtc,
    monitor_end_utc: monitorEndUtc,
    call_key: callKey,
  };
}

/**
 * The newer "CallDetailsCustom.*" shape: lowercase, deeply nested groups
 * (call/numbers/account/caller/website/attribution/outcome) instead of the flat
 * PascalCase fields the legacy family uses. No StudyID equivalent - `numbers.number_id`
 * plays that role for call_key purposes. `account.group_owner_name`/`group_owner_id`
 * play the AdvertiserName/AdvertiserID role for market resolution, and
 * `account.billing_group_name` plays the OrgGroupName fallback role.
 */
async function normalizeCustomCall(db: Db, data: Record<string, unknown>, action: string): Promise<NormalizedFields> {
  const call = (data.call ?? null) as Record<string, unknown> | null;
  const numbers = (data.numbers ?? null) as Record<string, unknown> | null;
  const account = (data.account ?? null) as Record<string, unknown> | null;
  const caller = (data.caller ?? null) as Record<string, unknown> | null;
  const attribution = (data.attribution ?? null) as Record<string, unknown> | null;

  const advertiserId = num(account?.group_owner_id);
  const advertiserName = str(account?.group_owner_name);
  const orgGroupName = str(account?.billing_group_name);
  const market = await resolveMarket(db, { AdvertiserID: advertiserId, AdvertiserName: advertiserName }, orgGroupName);

  const timezone = toIanaZone(str(call?.time_zone));

  const callerNumber = str(caller?.number);
  const calledNumber = str(numbers?.tracking_number);
  const numberId = num(numbers?.number_id);

  // Unlike the legacy family, every time field here is already suffixed "_utc" and
  // meant to be taken as true UTC - there's no separate local-time field to convert.
  const startUtc = utcStringToDate(str(call?.start_time_utc));
  const endUtc = utcStringToDate(str(call?.end_time_utc));
  const answerUtc = utcStringToDate(str(call?.answer_time_utc));

  const callKey = calledNumber && callerNumber && numberId !== null ? `${calledNumber}|${callerNumber}|${numberId}` : null;

  if (market && calledNumber) await recordTrackingNumberMarket(db, calledNumber, market);

  return {
    ...BLANK,
    action,
    market,
    advertiser_id: advertiserId,
    caller_number: callerNumber,
    called_number: calledNumber,
    study_id: numberId,
    ad_name: str(numbers?.number_name) ?? str(account?.group_name),
    answer_status: str(call?.answer_status),
    call_seconds: num(call?.duration),
    channel: str(attribution?.marchex_channel),
    paid: boolString(attribution?.marchex_paid),
    org_group: orgGroupName,
    timezone,
    start_utc: startUtc,
    end_utc: endUtc,
    answer_utc: answerUtc,
    // This family has no separate "monitor" instant - start_time_utc is the only
    // reliable timestamp on both CallStartCall and CallProcessed, so the linker (which
    // compares a start-side instant to a processed-side instant) uses it on both sides.
    monitor_start_utc: startUtc,
    call_key: callKey,
  };
}

/**
 * Website click/attribution events: no Action, no Notifications wrapper - the whole
 * delivery body (logged_at/marchex_response/received_from_browser/sent_to_marchex/site)
 * is treated as a single synthetic notification by ingest.ts. There's no caller number
 * yet at click time, so `called_number` is the tracking number the click was attributed
 * to, and market is resolved via that number against the self-filling tracking_numbers
 * lookup (populated by real calls to that same number), never from AdvertiserDetails.
 */
async function normalizeWebsiteClick(db: Db, data: Record<string, unknown>): Promise<NormalizedFields> {
  const marchexResponse = (data.marchex_response ?? null) as Record<string, unknown> | null;
  const body = (marchexResponse?.body ?? null) as Record<string, unknown> | null;
  const receivedFromBrowser = (data.received_from_browser ?? null) as Record<string, unknown> | null;
  const attribution = (receivedFromBrowser?.attribution ?? null) as Record<string, unknown> | null;

  const tagIds = Array.isArray(body?.tag_ids) ? (body.tag_ids as Record<string, unknown>[]) : [];
  const trackingNumbers = Array.from(
    new Set([
      ...(Array.isArray(receivedFromBrowser?.tracking_numbers) ? (receivedFromBrowser.tracking_numbers as unknown[]) : []),
      ...tagIds.map((t) => t.tracking_number),
    ].map((v) => str(v)).filter((v): v is string => v !== null)),
  );
  const calledNumber = trackingNumbers[0] ?? null;

  const market = await resolveMarketByTrackingNumber(db, trackingNumbers);

  const startUtc = utcStringToDate(str(body?.session_start_time)) ?? dateOrNull(str(data.logged_at));
  const endUtc = utcStringToDate(str(body?.session_end_time));

  return {
    ...BLANK,
    action: "WebsiteEvent.Click",
    market,
    called_number: calledNumber,
    channel: str(attribution?.utm_source),
    paid: typeof attribution?.gclid === "string" && attribution.gclid !== "" ? true : null,
    start_utc: startUtc,
    end_utc: endUtc,
    site: str(data.site),
    landing_page: str(receivedFromBrowser?.landing_page),
    referrer: str(receivedFromBrowser?.referrer),
    utm_source: str(attribution?.utm_source),
    utm_campaign: str(attribution?.utm_campaign),
  };
}

function dateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Builds the promoted/normalized fields for one Notifications[] entry (or synthetic equivalent). Never throws. */
export async function normalizeNotification(db: Db, data: Record<string, unknown>): Promise<NormalizedFields> {
  const action = str(data.Action);

  if (action && action.startsWith("CallDetailsCustom.")) {
    return normalizeCustomCall(db, data, action);
  }
  if (!action && isWebsiteClickShape(data)) {
    return normalizeWebsiteClick(db, data);
  }
  return normalizeLegacyCall(db, data, action);
}
