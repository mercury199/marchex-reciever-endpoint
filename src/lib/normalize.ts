import type { Db } from "mongodb";
import { resolveMarket } from "./market.js";
import { toIanaZone, zonedLocalStringToUtc, utcStringToDate } from "./timezone.js";

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
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Builds the promoted/normalized fields for one Notifications[] entry. Never throws. */
export async function normalizeNotification(
  db: Db,
  data: Record<string, unknown>,
): Promise<NormalizedFields> {
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

  // CallStartCall nests the caller number under CallerDetails.PhoneNumber too; CallerNumber
  // is present on both action types and is the one we trust.
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

  return {
    action: str(data.Action),
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
