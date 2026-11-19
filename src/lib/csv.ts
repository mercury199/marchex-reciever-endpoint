export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Quotes a phone number so Excel/Sheets never re-interprets it as a number. */
export function csvPhoneCell(value: unknown, excelTab: boolean): string {
  if (value === null || value === undefined) return "";
  const quoted = `"${String(value).replace(/"/g, '""')}"`;
  return excelTab ? `\t${quoted}` : quoted;
}
