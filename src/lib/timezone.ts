const ZONE_MAP: Record<string, string> = {
  Eastern: "America/New_York",
  Central: "America/Chicago",
  Mountain: "America/Denver",
  Pacific: "America/Los_Angeles",
};

export function toIanaZone(zoneName: string | null | undefined): string | null {
  if (!zoneName) return null;
  return ZONE_MAP[zoneName] ?? null;
}

/** Offset (ms) to ADD to a UTC instant to get local wall-clock time in `timeZone`. */
function getOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a naive "YYYY-MM-DDTHH:mm:ss" wall-clock string, understood to be local
 * time in `timeZone`, into a real UTC Date. Returns null for unparseable input or
 * an unrecognized IANA zone.
 */
export function zonedLocalStringToUtc(value: string | null | undefined, timeZone: string | null): Date | null {
  if (!value || !timeZone) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const guessUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offset = getOffsetMs(new Date(guessUtcMs), timeZone);
  // offset = (local wall clock as if UTC) - guessUtcMs, i.e. local = utc + offset.
  // We want utc = local - offset.
  return new Date(guessUtcMs - offset);
}

/**
 * Parses a naive "YYYY-MM-DDTHH:mm:ss(.sss)?" string that is ALREADY UTC (no zone
 * conversion), per Marchex's CallDate / MonitorStartTime / MonitorEndTime / Properties.UTC.
 */
export function utcStringToDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, frac] = match;
  const ms = frac ? Math.round(Number(frac) * 1000) : 0;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms));
}
