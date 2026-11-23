export interface CallEvent {
  _id: string;
  action: string | null;
  market: string | null;
  ad_name: string | null;
  caller_number: string | null;
  called_number: string | null;
  answer_status: string | null;
  call_seconds: number | null;
  channel: string | null;
  paid: boolean | null;
  registered_dnc: boolean | null;
  start_utc: string | null;
  linked_event_id: string | null;
  linked_request_id: string | null;
  // Website-click events only (action: "WebsiteEvent.Click"); null on calls.
  site: string | null;
  landing_page: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AttributionRow {
  click: CallEvent;
  call: CallEvent | null;
  deltaSeconds: number | null;
}

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

export interface FieldCatalogEntry {
  path: string;
  types_seen: string[];
  count: number;
}

export interface Filter {
  path: string;
  operator: "equals" | "not_equals" | "contains" | "in" | "exists" | "gt" | "lt" | "between";
  value?: unknown;
}

export interface ForwardTarget {
  _id: string;
  url: string;
  enabled: boolean;
  action_filter: string | null;
  market_filter: string | null;
  headers: Record<string, string>;
}

export interface ForwardJob {
  _id: string;
  raw_delivery_id: string;
  target_id: string;
  status: "pending" | "in_progress" | "succeeded" | "failed";
  attempts: number;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  last_attempt_at: string | null;
}

export interface RawDelivery {
  _id: string;
  request_id: string | null;
  received_at: string;
  parse_error: string | null;
  processed_at: string | null;
  processing_error: string | null;
  attempt: number | null;
}

class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? `request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ authenticated: boolean }>("/api/auth/me"),
  health: () => request<{ status: string; mongo: string; timestamp: string }>("/health"),

  markets: () => request<{ markets: string[] }>("/api/markets"),
  fieldCatalog: () => request<{ entries: FieldCatalogEntry[] }>("/api/field-catalog"),

  calls: (params: URLSearchParams) =>
    request<{ rows: CallEvent[]; total: number; page: number; pageSize: number }>(`/api/calls?${params.toString()}`),
  callDetail: (id: string) => request<{ event: CallEvent; linked: CallEvent | null }>(`/api/calls/${id}`),

  forwardTargets: () => request<{ targets: ForwardTarget[] }>("/api/forward-targets"),
  createForwardTarget: (input: Partial<ForwardTarget>) =>
    request<{ _id: string }>("/api/forward-targets", { method: "POST", body: JSON.stringify(input) }),
  updateForwardTarget: (id: string, input: Partial<ForwardTarget>) =>
    request<{ ok: boolean }>(`/api/forward-targets/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteForwardTarget: (id: string) => request<{ ok: boolean }>(`/api/forward-targets/${id}`, { method: "DELETE" }),
  forwardJobs: (status?: string) =>
    request<{ jobs: ForwardJob[] }>(`/api/forward-jobs${status ? `?status=${status}` : ""}`),
  retryForwardJob: (id: string) => request<{ ok: boolean }>(`/api/forward-jobs/${id}/retry`, { method: "POST" }),

  attribution: (params: URLSearchParams) =>
    request<{ rows: AttributionRow[]; windowSeconds: number; requireSameNumber: boolean }>(`/api/attribution?${params.toString()}`),
  attributionSettings: () => request<{ windowSeconds: number; requireSameNumber: boolean }>("/api/settings/attribution"),
  saveAttributionSettings: (input: { windowSeconds: number; requireSameNumber: boolean }) =>
    request<{ ok: boolean }>("/api/settings/attribution", { method: "PUT", body: JSON.stringify(input) }),

  numberBreakdown: (params: URLSearchParams) =>
    request<{ rows: NumberBreakdownRow[] }>(`/api/analytics/numbers?${params.toString()}`),
  dashboardStats: (params: URLSearchParams) => request<DashboardStats>(`/api/analytics/dashboard?${params.toString()}`),

  rawDeliveries: (params: URLSearchParams) =>
    request<{ rows: RawDelivery[]; total: number; page: number; pageSize: number }>(`/api/raw-deliveries?${params.toString()}`),
  reprocessRawDelivery: (id: string) => request<{ ok: boolean }>(`/api/raw-deliveries/${id}/reprocess`, { method: "POST" }),
};

export function buildExportUrl(kind: "csv" | "xlsx", params: URLSearchParams): string {
  return `/api/export.${kind}?${params.toString()}`;
}

export function buildAttributionExportUrl(params: URLSearchParams): string {
  return `/api/attribution/export.csv?${params.toString()}`;
}
