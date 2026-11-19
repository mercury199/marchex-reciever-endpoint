# Design: Marchex Webhook Receiver

Status: **draft — awaiting approval**. No application code has been written yet. This
document is step 1 of the build process; implementation starts only after this is approved.

## 1. Fixtures

`fixtures/marchex/*.json` holds the 19 notification deliveries from
`Marchex webhook data.md`, split one-delivery-per-file (each file is a complete, valid
delivery payload — `Attempt`, `Id`, `Notifications[]`, `Properties` — exactly as Marchex
would POST it, byte-identical to the source other than pretty-printing). Files are numbered
`01`–`19` in ascending order of `Properties.UTC` (the receive time), with a short
`<market>-<action>-<callernumber>` suffix for human scanning. In this sample set every
delivery happens to carry exactly one `Notifications[]` item, but nothing in the design may
assume that — see §4.

Of note for tests:
- `14-heartland-start-9136261939.json` / `19-heartland-processed-9136261939.json` are the
  linkable start↔processed pair (same `CalledNumber` 8444476600, same `StudyID` 13994891,
  `CallDate` 18:33:42.099 vs `MonitorStartTime` 18:33:41.867 — 0.6s apart, well inside ±2min).
- `13-heartland-start-8167182325.json` / `15-heartland-processed-8167182325.json` is a
  second, independent Heartland pair (different caller) — a second true link, used to prove
  the matcher doesn't just hardcode the one pair.
- `04-rockymountain-start-report-2103661898.json` and
  `10-rockymountain-processed-report-5095756990.json` share `StudyID` 13994850 and
  `AdDefinitionName`/`StudyName` "report" but have **different callers** — this must NOT
  link. It's the fixture that proves "leave unmatched events unlinked."
- `02`/`08`/`07` etc. are CallStartCall events with no matching CallProcessed anywhere in the
  set — permanently unlinked, must still be stored.
- Every `CallStartCall` fixture has `AdvertiserDetails.AdvertiserName` absent (only
  `AdvertiserID`), confirming market must fall back to `OrgGroupName` minus " - default", or
  to a learned `advertisers` lookup once a `CallProcessed` for that `AdvertiserID` arrives.

No fixture currently has an unknown `Action` or a renamed/extra field — the task requires a
test fixture covering that case. Since inventing Marchex data isn't "splitting the provided
file," that fixture will be added by hand in step 2 (ingest tests), explicitly marked as a
synthetic fixture (e.g. `fixtures/marchex/synthetic-unknown-action.json`), not mixed into the
01–19 real-sample set. Flagging this now rather than silently deviating.

## 2. Stack choices

- **Fastify** over Express: native async/await route handlers (no wrapper needed to catch
  rejected promises before the 500ms webhook deadline), built-in JSON schema compilation is
  simply not used (Zod handles validation per the constraint), and its plugin encapsulation
  keeps the webhook route, API routes, and static dashboard serving cleanly separated.
- Official `mongodb` driver, no Mongoose — required by the brief; also a natural fit since
  `call_events.data` is deliberately schemaless.
- Zod validates *our own API* inputs (query params, forward-target CRUD bodies) — never the
  webhook body, which is stored as-is regardless of shape.
- React + Vite + TanStack Table (+ TanStack Query for data fetching) for the dashboard, built
  to `dist/` and served as static files by the same Fastify process in production.

## 3. Collections

All collections live in the single Mongo database named by the connection string in
`MONGO_URL`. Every document gets a native Mongo `_id`; fields below are in addition to it.

### 3.1 `raw_deliveries` — source of truth, never reshaped

```ts
{
  _id: ObjectId,
  request_id: string | null,       // Properties.RequestId if parseable, else null
  received_at: Date,               // server receive time
  headers: Record<string, string>, // as received (lowercased keys, per Node http)
  content_type: string | null,
  raw_body: string,                // exact bytes of the request body, as utf8 text
  parse_error: string | null,      // set when raw_body is not valid JSON, or lacks
                                    // Notifications[]/Properties.RequestId; raw_body is
                                    // still stored untouched
  attempt: number | null,          // top-level Attempt, if parse succeeded
  processed_at: Date | null,       // when the async exploder finished (or died) on this delivery
  processing_error: string | null, // set if explosion into call_events threw
}
```

- Unique index on `request_id`, **partial** (`request_id: { $type: "string" }`) so repeated
  `null`s (unparseable bodies with no recoverable RequestId) don't collide on the unique
  constraint. A resend with the same `RequestId` hits the unique index and is rejected as a
  duplicate key, which the webhook handler treats as "already stored" (still returns 200).
- If the body parses as JSON but has no `Properties.RequestId`, we still store it (never
  reject), with `request_id: null` and a `parse_error` describing what's missing — this is
  the one case where the *content* is JSON but dedupe can't apply.
- `raw_body` is stored as the literal string from the HTTP body, not as a parsed/re-serialized
  object — this is what "never rename or reshape what is stored in raw_deliveries" means in
  practice: no `JSON.parse` → `JSON.stringify` round trip, which would reorder keys and
  normalize whitespace.

### 3.2 `call_events` — one document per `Notifications[]` entry

```ts
{
  _id: ObjectId,
  raw_delivery_id: ObjectId,   // -> raw_deliveries._id
  request_id: string,          // denormalized from the parent delivery, for easy lookups
  notification_index: number,  // position within Notifications[], for traceability
  data: object,                 // the notification object, exactly as received (untouched)

  // promoted/normalized fields, all derived from `data`, all optional except `action`:
  action: string,               // data.Action, e.g. "CallDetails.CallStartCall"
  market: string | null,        // resolved per §6
  advertiser_id: number | null,
  caller_number: string | null, // 10-digit string
  called_number: string | null, // 10-digit string
  study_id: number | null,
  ad_name: string | null,
  telmetrics_id: number | null, // only present on CallProcessed in current samples
  answer_status: string | null,
  call_seconds: number | null,
  registered_dnc: boolean | null,
  channel: string | null,       // MarketingAttribution.Channel
  paid: boolean | null,         // MarketingAttribution.Paid
  org_group: string | null,     // OrgGroupName, raw (with " - default" if present)
  timezone: string | null,      // IANA zone, mapped from data.TimeZone (see §7)

  // UTC-normalized Date fields, derived per §7; null if the source string is absent/unparseable:
  start_utc: Date | null,       // CallStartCall: CallDate. CallProcessed: StartTime converted via timezone.
  end_utc: Date | null,         // CallProcessed: EndTime converted via timezone. null for CallStartCall.
  answer_utc: Date | null,      // CallProcessed: AnswerTime converted via timezone.
  monitor_start_utc: Date | null,  // CallProcessed: MonitorStartTime (already UTC, just parsed)
  monitor_end_utc: Date | null,    // CallProcessed: MonitorEndTime (already UTC, just parsed)

  // linking (see §5)
  call_key: string | null,      // `${CalledNumber}|${CallerNumber}|${StudyID}`, null if any part missing
  linked_event_id: ObjectId | null,  // the matched counterpart's _id, set on BOTH sides
  linked_request_id: string | null,  // denormalized, for display without a join

  created_at: Date,
}
```

Indexes:
- `{ request_id: 1, notification_index: 1 }` unique — this is the real dedupe boundary for
  events (a resent delivery that got past `raw_deliveries` some other way, e.g. manual
  reprocess, still can't double-insert events).
- `{ market: 1, start_utc: 1 }`
- `{ caller_number: 1 }`
- `{ called_number: 1 }`
- `{ action: 1 }`
- `{ registered_dnc: 1 }`
- `{ telmetrics_id: 1 }`
- `{ call_key: 1, linked_event_id: 1 }` — used by the linker to find unlinked candidates fast.

All promoted fields are **derived, nullable, and never authoritative** — `data` is always
re-read when a value is needed with certainty (e.g. export). Promoted fields exist purely to
make common queries/sorts index-able without a `data.<path>` scan.

### 3.3 `field_catalog` — drives the dashboard's generic filter builder

```ts
{
  _id: ObjectId,
  path: string,                 // dot-path into call_events.data, e.g. "AdDetails.AdDefinitionName"
  types_seen: string[],         // JSON types observed: "string" | "number" | "boolean" | "null" | "object" | "array"
  first_seen: Date,
  last_seen: Date,
  count: number,                // number of events that have had this path present (non-undefined)
}
```

- Unique index on `path`.
- Populated by flattening `data` on every ingested event (object → dot-paths, arrays treated
  as a single leaf at the array's own path — we do not index into array elements, since
  `Notifications` arrays are already split out and no other array in the sample payloads needs
  per-element filtering). `null` and `{}` are both recorded as types seen at that path (this is
  exactly the "field switches between null and {}" case from the brief) rather than as presence
  vs. absence.
- Upsert is `$addToSet` on `types_seen`, `$min` on `first_seen`, `$max` on `last_seen`, `$inc`
  on `count` — one multi-field update per path per event, batched per event in a single
  `bulkWrite`.
- The dashboard filter builder reads this collection to populate the field dropdown and to
  validate/whitelist any path a filter request references (see §9) — a path not present here
  is rejected, closing the injection surface named in the brief.

### 3.4 `advertisers` — AdvertiserID → name lookup, self-filling

```ts
{
  _id: number,          // AdvertiserID
  name: string,         // AdvertiserDetails.AdvertiserName
  org_group: string | null,  // OrgGroupName last seen with this advertiser, for fallback/debug
  updated_at: Date,
}
```

- Upserted every time an event's `data` carries both `AdvertiserDetails.AdvertiserID` and a
  non-empty `AdvertiserDetails.AdvertiserName` (i.e. every `CallProcessed`, and any future
  action type that happens to carry both). `CallStartCall` events never write here since they
  never carry `AdvertiserName`.
- Read during market resolution for events that carry only `AdvertiserID` (see §6).

### 3.5 `forward_targets`

```ts
{
  _id: ObjectId,
  url: string,
  enabled: boolean,
  action_filter: string | null,    // exact match against data.Action, or null = all actions
  market_filter: string | null,    // exact match against resolved market, or null = all markets
  headers: Record<string, string>, // extra headers to send, e.g. custom auth for the target
  created_at: Date,
  updated_at: Date,
}
```

- Seeded at startup from `FORWARD_URLS` (comma-separated), one target per URL, only if a
  target with that exact `url` doesn't already exist (idempotent re-seed on redeploy; seeded
  targets are editable afterward like any other).

### 3.6 `forward_jobs` — the Mongo-backed queue

```ts
{
  _id: ObjectId,
  raw_delivery_id: ObjectId,
  target_id: ObjectId,
  status: "pending" | "in_progress" | "succeeded" | "failed",
  attempts: number,
  max_attempts: 5,
  next_attempt_at: Date,
  last_attempt_at: Date | null,
  last_status_code: number | null,
  last_latency_ms: number | null,
  last_response_body: string | null,  // truncated to e.g. 2000 chars
  last_error: string | null,          // network-level error (DNS, timeout, etc.), if any
  created_at: Date,
}
```

- One job per `(raw_delivery, enabled target matching that delivery's events at enqueue time)`.
  Enqueued right after the raw delivery is stored (fire-and-forget from the webhook handler's
  point of view — it does not block the 200 response).
- A poller (`setInterval`, no external scheduler) claims pending jobs where
  `next_attempt_at <= now` via `findOneAndUpdate` with `status: "pending"` in the filter and
  `status: "in_progress"` in the update, so multiple app instances (if ever scaled beyond 1)
  don't double-send. Backoff schedule: attempt 1 immediate, then 1m, 5m, 20m, 60m (capped),
  for a max of 5 attempts.
- Forward request body is `raw_deliveries.raw_body` sent byte-for-byte with the original
  `content_type` header — never the parsed/re-serialized JSON.
- The dashboard's "retry" button resets a `failed` job to `pending` with `attempts: 0` and
  `next_attempt_at: now`.

### 3.7 Dashboard auth — no dedicated collection

Session state is a signed, httpOnly cookie (Fastify `@fastify/secure-session` or equivalent)
containing just `{ authenticated: true }`; credentials are the two env vars, compared
constant-time. No session store needed since there's exactly one dashboard account.

## 4. Ingest pipeline

1. `POST /webhooks/marchex/:token`: constant-time compare `:token` against `WEBHOOK_TOKEN`
   (`crypto.timingSafeEqual` on fixed-length buffers — pad/hash both sides first since the
   token lengths themselves must not leak via early-exit comparison). Mismatch → 404 (not 401/403,
   so the endpoint's existence isn't confirmed to a prober).
2. Read the raw body as text (Fastify content-type parser overridden to pass through `*/*` as
   text, since we must accept non-JSON bodies).
3. Insert into `raw_deliveries` synchronously (this is the one Mongo write allowed to be on the
   request's critical path, since it's what makes the 200 meaningful — without it a crash right
   after responding would silently lose the delivery). Attempt a `JSON.parse`; on failure, store
   with `parse_error` set and stop here (still 200). On success, check for `Notifications` array
   and `Properties.RequestId`; if either is missing, store with `parse_error` describing which,
   and stop (still 200) — there is nothing to explode.
   - Duplicate key on `request_id` → fetch and reuse the existing document's `_id` instead of
     erroring; this is the resend/`Attempt > 1` path and must still return 200.
4. Return 200 immediately after step 3.
5. `setImmediate`/fire-and-forget: explode `Notifications[]` into `call_events` (skipped if that
   `raw_delivery_id` already has events — covers resends), update `field_catalog`, update
   `advertisers`, run the linker (§5), and enqueue `forward_jobs` for matching enabled targets.
   Errors here are caught and written to `raw_deliveries.processing_error` — never thrown back
   at the HTTP layer, and never cause the delivery itself to be rejected or altered.
6. Unknown `Notifications[].Action` values: step 5 still creates a `call_events` document;
   `action` is set verbatim and every promoted field that doesn't apply to that shape is simply
   `null`. `field_catalog` still records whatever paths exist under `data`. Nothing about the
   pipeline branches on a whitelist of known actions.

Each raw delivery can carry >1 notification (not seen in the samples, but required by spec);
step 5 loops over the array and produces one `call_events` doc per item, each with its own
`notification_index`.

## 5. Start↔processed linking

Runs as part of step 5 above, once per newly-inserted `call_events` document (not a periodic
batch job — linking happens at ingest time so the dashboard drawer is accurate immediately).

`call_key = \`${CalledNumber}|${CallerNumber}|${StudyID}\`` (all three required; events missing
any of them get `call_key: null` and are never linked).

When a new event with a non-null `call_key` arrives:
1. Determine candidate action: `CallStartCall` looks for an unlinked `CallProcessed`;
   `CallProcessed` looks for an unlinked `CallStartCall`. (Any future action type with a
   `call_key` but no defined counterpart type simply never matches — linking is opt-in per
   pair of known action types, not "any two events that share a call_key.")
2. Query `call_events` for `{ call_key, action: <counterpart action>, linked_event_id: null }`.
3. For each candidate, compare the relevant UTC instants:
   `abs(newEvent.start_or_monitor_instant - candidate.start_or_monitor_instant) <= 2 minutes`,
   using `start_utc` (CallStartCall's `CallDate`) vs. `monitor_start_utc` (CallProcessed's
   `MonitorStartTime`) — both already-UTC fields, so no timezone conversion is involved in the
   comparison itself (avoids compounding any zone-mapping error into the match decision).
4. First candidate within the window wins (ties broken by smallest time delta; in practice
   `call_key` + a 2-minute window should produce at most one candidate per ingest, as the
   fixtures confirm — the 04/10 Rocky Mountain "report" pair is excluded by `call_key` itself
   since the caller numbers differ, so it never reaches step 3).
5. On a match, both documents are updated: `linked_event_id` and `linked_request_id` set on
   each pointing at the other. No match → `linked_event_id` stays `null`; the event is stored
   and queryable regardless (never dropped, never blocked on finding a link).

Because this runs at ingest time, order matters: whichever of the pair arrives first is
necessarily unlinked until the second arrives (expected — `CallStartCall` always precedes its
`CallProcessed` by definition of the call lifecycle in these samples).

## 6. Market resolution

Computed once per event, in this order, and stored as the promoted `market` field (never
recomputed on read — re-running normalization, e.g. via "reprocess" on a raw delivery,
recomputes it):

1. `data.AdvertiserDetails.AdvertiserName` if present and non-empty → use it directly, and
   upsert `advertisers[AdvertiserID] = { name, org_group }` (this is what makes the lookup
   self-filling: every `CallProcessed` feeds it).
2. Else, if `data.AdvertiserDetails.AdvertiserID` is present, look it up in `advertisers`. Hit
   → use the stored name. This is how a `CallStartCall` (which never carries `AdvertiserName`)
   resolves to a real market once any `CallProcessed` for that same advertiser has ever been
   seen — including ones from other calls entirely, which is the point of a shared lookup.
3. Else (lookup miss, e.g. this `AdvertiserID` has never appeared on a `CallProcessed`, or
   `AdvertiserDetails` is entirely absent for this action type), fall back to
   `data.OrgGroupName` with a literal trailing `" - default"` stripped (only that exact
   suffix — not a generic "last two words" heuristic, since "Rocky Mountain Mens" itself
   contains a space and must not be mangled).
4. Else `null` (no market could be resolved) — never thrown, never blocks ingest.

Because step 2's lookup result depends on ingest order, a `CallStartCall` that arrives before
any `CallProcessed` ever has for that advertiser will resolve via step 3 (`OrgGroupName`) and
get a `market` value that *happens* to agree with step 1's eventual value in all current
fixtures (e.g. "Atlantic Mens - default" → "Atlantic Mens"), but isn't guaranteed to in
general (a market could rename its `AdvertiserName` without renaming its `OrgGroupName`).
This is accepted as a documented limitation rather than solved with reprocessing-on-write,
since the brief's "reprocess" action (raw deliveries page) is the designed escape hatch for
exactly this kind of drift after the fact.

## 7. Timezone normalization

`data.TimeZone` is one of `"Eastern"`, `"Central"`, `"Mountain"` in the samples (future values
expected). Mapped via a small IANA table:

```ts
const ZONE_MAP: Record<string, string> = {
  Eastern:  "America/New_York",
  Central:  "America/Chicago",
  Mountain: "America/Denver",
  Pacific:  "America/Los_Angeles", // not in samples, added defensively
};
```

An unrecognized zone name logs to `processing_error` context but does not fail the event —
the local-time fields simply stay unconverted (`start_utc` etc. left `null`), while the raw
string is still preserved untouched in `data`.

- `StartTime`, `AnswerTime`, `EndTime` (no offset, no "Z") are parsed as **wall-clock time in
  `data.TimeZone`** and converted to a real UTC `Date` via the IANA zone (DST-aware — the
  `-05:00`/`-06:00` offset for `America/Chicago` etc. is derived from the zone + date, not
  hardcoded, since Marchex's "Central"/"Eastern" will cross DST boundaries over a year).
- `CallDate`, `MonitorStartTime`, `MonitorEndTime`, `Properties.UTC` (no offset, no "Z", but
  already UTC per the brief) are parsed as plain UTC wall-clock strings (append `Z` /
  `Date.UTC(...)`, not zone-converted).
- Both the original string and the derived `Date` are kept: the original lives untouched
  inside `data`; the derived field (`start_utc` etc.) is the promoted, indexed, sortable
  value the dashboard and API use.
- Library: `date-fns-tz` (or `Intl.DateTimeFormat` with the zone, hand-rolled) — decided in
  step 2 when the actual conversion code is written; either way it's a single small utility
  function, not a new runtime dependency category the brief would need to bless separately.

## 8. Field catalog flattening rule

Given `data`, walk it recursively building dot-paths:
- Object → recurse, joining keys with `.` (e.g. `AdDetails.AdDefinitionName`).
- Array → **stop**, record the path itself as type `"array"` (we do not flatten into
  `Notifications[0]...` since `Notifications` has already been split into separate
  `call_events`, and no other array appears in the sample payloads — a future payload with a
  meaningfully filterable array would need a follow-up design note, not silent indexing).
- `null` → record type `"null"` at that path.
- Primitive (`string`/`number`/`boolean`) → record that type at that path.
- Empty object `{}` → recorded as type `"object"` at that path, no children (this plus the
  `null` case above is exactly how a field "switching between null and {}" shows up as two
  entries in `types_seen` at the same path over time, which is the intended signal for "this
  field is unreliable, don't assume a shape").

## 9. Query/filter safety (API, built in step 4)

- Every filter the dashboard sends names a `path` (a `field_catalog.path` value) and an
  operator. The API loads the current `field_catalog` paths into a whitelist set and rejects
  any filter whose `path` isn't in it, before building any Mongo query fragment.
- Any path segment starting with `$` is rejected outright (defense in depth even though the
  whitelist should already exclude it, since Mongo keys can't start with `$` in stored
  documents anyway).
- Filters resolve to `data.<path>` for anything not in the promoted-field set, or directly to
  the promoted field name (e.g. `market`, `registered_dnc`) when the path matches one of
  those — so common filters hit the indexes in §3.2 instead of an unindexed `data.*` scan.
- Operators (`equals`, `not equals`, `contains`, `in`, `exists`, `>`, `<`, `between`) map to a
  fixed, hand-written set of Mongo operators (`$eq`, `$ne`, `$regex` with escaped literal
  input, `$in`, `$exists`, `$gt`, `$lt`, `$gte`+`$lte`) — the operator string itself is also
  checked against a fixed enum, never interpolated.

## 10. Open questions / things flagged rather than assumed

- The brief's `AnswerStatusId` isn't in the promoted field list given — kept only inside
  `data`, since `AnswerStatus` (the string) is what's listed for the default columns.
- `RingCount`, `VoiceRecordingUrl`, etc. are not promoted either — available via the generic
  filter builder against `data.*` like any other field_catalog entry, per the "no code change
  needed for new fields" requirement.
- `BillableMinutes` is `null` in every sample; no special handling beyond normal flattening.

---

Everything above is implementable from the fixtures as split. No app code, `package.json`, or
dependency has been added yet. Please review and approve before step 2 (ingest + bootstrap +
tests) begins.
