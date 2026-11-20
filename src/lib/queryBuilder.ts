import type { Db, Filter, Document } from "mongodb";

export type FieldKind = "string" | "number" | "boolean" | "date";

interface FieldDef {
  mongoField: string;
  kind: FieldKind;
  aliases: string[];
}

/**
 * Promoted fields and their known raw-payload aliases. A filter path matching any
 * alias here resolves to the indexed promoted field instead of an unindexed data.*
 * scan. "market" has no raw alias since it's purely derived.
 */
const FIELD_DEFS: FieldDef[] = [
  { mongoField: "market", kind: "string", aliases: ["market"] },
  { mongoField: "action", kind: "string", aliases: ["action", "Action"] },
  { mongoField: "advertiser_id", kind: "number", aliases: ["advertiser_id", "AdvertiserDetails.AdvertiserID"] },
  { mongoField: "caller_number", kind: "string", aliases: ["caller_number", "CallerNumber", "CallerDetails.PhoneNumber"] },
  { mongoField: "called_number", kind: "string", aliases: ["called_number", "CalledNumber"] },
  { mongoField: "study_id", kind: "number", aliases: ["study_id", "StudyID", "StudyDetails.StudyID"] },
  {
    mongoField: "ad_name",
    kind: "string",
    aliases: ["ad_name", "AdDefinitionName", "AdDetails.AdDefinitionName", "StudyDetails.StudyName"],
  },
  { mongoField: "telmetrics_id", kind: "number", aliases: ["telmetrics_id", "TelmetricsId"] },
  { mongoField: "answer_status", kind: "string", aliases: ["answer_status", "AnswerStatus"] },
  { mongoField: "call_seconds", kind: "number", aliases: ["call_seconds", "CallSeconds"] },
  { mongoField: "registered_dnc", kind: "boolean", aliases: ["registered_dnc", "RegisteredDNC"] },
  { mongoField: "channel", kind: "string", aliases: ["channel", "MarketingAttribution.Channel"] },
  { mongoField: "paid", kind: "boolean", aliases: ["paid", "MarketingAttribution.Paid"] },
  { mongoField: "org_group", kind: "string", aliases: ["org_group", "OrgGroupName"] },
  { mongoField: "timezone", kind: "string", aliases: ["timezone", "TimeZone"] },
  { mongoField: "start_utc", kind: "date", aliases: ["start_utc"] },
  { mongoField: "end_utc", kind: "date", aliases: ["end_utc"] },
  { mongoField: "answer_utc", kind: "date", aliases: ["answer_utc"] },
  { mongoField: "monitor_start_utc", kind: "date", aliases: ["monitor_start_utc"] },
  { mongoField: "monitor_end_utc", kind: "date", aliases: ["monitor_end_utc"] },
  // Website-click events only (lib/normalize.ts normalizeWebsiteClick); null on calls.
  { mongoField: "site", kind: "string", aliases: ["site"] },
  { mongoField: "landing_page", kind: "string", aliases: ["landing_page"] },
  { mongoField: "referrer", kind: "string", aliases: ["referrer"] },
  { mongoField: "utm_source", kind: "string", aliases: ["utm_source"] },
  { mongoField: "utm_campaign", kind: "string", aliases: ["utm_campaign"] },
];

const ALIAS_MAP = new Map<string, FieldDef>();
for (const def of FIELD_DEFS) {
  for (const alias of def.aliases) ALIAS_MAP.set(alias, def);
}

export const DEFAULT_SORT_FIELD = "start_utc";

export const OPERATORS = ["equals", "not_equals", "contains", "in", "exists", "gt", "lt", "between"] as const;
export type Operator = (typeof OPERATORS)[number];

export interface FilterInput {
  path: string;
  operator: Operator;
  value?: unknown;
}

export class InvalidFilterError extends Error {}

function hasDollarSegment(path: string): boolean {
  return path.split(".").some((segment) => segment.startsWith("$"));
}

/**
 * Resolves a client-supplied path to a safe Mongo field + value kind, per
 * docs/DESIGN.md §9: known promoted-field aliases first, then a whitelist check
 * against field_catalog for anything else. Never trusts the path otherwise.
 */
export function resolvePath(path: string, catalogPaths: ReadonlySet<string>): { mongoField: string; kind: FieldKind } {
  if (!path || hasDollarSegment(path)) {
    throw new InvalidFilterError(`invalid path: ${path}`);
  }

  const known = ALIAS_MAP.get(path);
  if (known) return { mongoField: known.mongoField, kind: known.kind };

  if (catalogPaths.has(path)) {
    return { mongoField: `data.${path}`, kind: "string" };
  }

  throw new InvalidFilterError(`unknown field path: ${path}`);
}

function coerce(value: unknown, kind: FieldKind): unknown {
  if (value === null || value === undefined) return value;
  switch (kind) {
    case "date": {
      const d = new Date(value as string);
      if (Number.isNaN(d.getTime())) throw new InvalidFilterError(`invalid date value: ${String(value)}`);
      return d;
    }
    case "number": {
      const n = Number(value);
      if (Number.isNaN(n)) throw new InvalidFilterError(`invalid number value: ${String(value)}`);
      return n;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw new InvalidFilterError(`invalid boolean value: ${String(value)}`);
    default:
      return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyOperator(mongoField: string, operator: Operator, value: unknown, kind: FieldKind): Filter<Document> {
  switch (operator) {
    case "equals":
      return { [mongoField]: coerce(value, kind) };
    case "not_equals":
      return { [mongoField]: { $ne: coerce(value, kind) } };
    case "contains":
      return { [mongoField]: { $regex: escapeRegExp(String(value)), $options: "i" } };
    case "in": {
      const arr = Array.isArray(value) ? value : [value];
      return { [mongoField]: { $in: arr.map((v) => coerce(v, kind)) } };
    }
    case "exists":
      return { [mongoField]: { $exists: Boolean(value) } };
    case "gt":
      return { [mongoField]: { $gt: coerce(value, kind) } };
    case "lt":
      return { [mongoField]: { $lt: coerce(value, kind) } };
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new InvalidFilterError("between requires a two-element [min, max] value");
      }
      return { [mongoField]: { $gte: coerce(value[0], kind), $lte: coerce(value[1], kind) } };
    }
    default:
      throw new InvalidFilterError(`unsupported operator: ${String(operator)}`);
  }
}

export async function loadCatalogPaths(db: Db): Promise<Set<string>> {
  const docs = await db.collection("field_catalog").find({}, { projection: { path: 1 } }).toArray();
  return new Set(docs.map((d) => d.path as string));
}

export interface CallsQueryOptions {
  market?: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: FilterInput[];
}

/** Builds the full $and query for the calls list/export endpoints. */
export function buildCallsQuery(options: CallsQueryOptions, catalogPaths: ReadonlySet<string>): Filter<Document> {
  const clauses: Filter<Document>[] = [];

  if (options.market) {
    clauses.push({ market: options.market });
  }

  if (options.dateFrom || options.dateTo) {
    const range: Record<string, Date> = {};
    if (options.dateFrom) range.$gte = coerce(options.dateFrom, "date") as Date;
    if (options.dateTo) range.$lte = coerce(options.dateTo, "date") as Date;
    clauses.push({ start_utc: range });
  }

  for (const filter of options.filters ?? []) {
    const { mongoField, kind } = resolvePath(filter.path, catalogPaths);
    clauses.push(applyOperator(mongoField, filter.operator, filter.value, kind));
  }

  if (clauses.length === 0) return {};
  return { $and: clauses };
}

export function resolveSortField(path: string | undefined, catalogPaths: ReadonlySet<string>): string {
  if (!path) return DEFAULT_SORT_FIELD;
  return resolvePath(path, catalogPaths).mongoField;
}
