import type { FastifyInstance } from "fastify";
import type { Db, Document, WithId } from "mongodb";
import { z } from "zod";
import ExcelJS from "exceljs";
import { buildCallsQuery, loadCatalogPaths, InvalidFilterError, OPERATORS } from "../../lib/queryBuilder.js";
import { csvEscape, csvPhoneCell } from "../../lib/csv.js";

const DEFAULT_COLUMNS = [
  "start_utc",
  "market",
  "ad_name",
  "caller_number",
  "called_number",
  "action",
  "answer_status",
  "call_seconds",
  "channel",
  "paid",
  "registered_dnc",
];

const PHONE_COLUMNS = new Set(["caller_number", "called_number"]);
const REQUIRED_COLUMN = "registered_dnc";

const FilterSchema = z.object({
  path: z.string().min(1).max(300),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

const ExportQuerySchema = z.object({
  market: z.string().min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  filters: z.string().optional(),
  columns: z.string().optional(),
  excelTab: z.coerce.boolean().optional().default(false),
});

function resolveColumns(raw: string | undefined): string[] {
  const requested = raw ? raw.split(",").map((c) => c.trim()).filter(Boolean) : DEFAULT_COLUMNS;
  return requested.includes(REQUIRED_COLUMN) ? requested : [...requested, REQUIRED_COLUMN];
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function getColumnValue(doc: WithId<Document>, column: string): unknown {
  if (column in doc) return doc[column];
  return getByPath(doc.data, column);
}

function parseFiltersAndQuery(query: z.infer<typeof ExportQuerySchema>, catalogPaths: ReadonlySet<string>) {
  let filters: z.infer<typeof FilterSchema>[] = [];
  if (query.filters) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(query.filters);
    } catch {
      throw new InvalidFilterError("filters must be valid JSON");
    }
    const result = z.array(FilterSchema).safeParse(parsed);
    if (!result.success) throw new InvalidFilterError("filters must be an array of { path, operator, value }");
    filters = result.data;
  }
  return buildCallsQuery({ market: query.market, dateFrom: query.dateFrom, dateTo: query.dateTo, filters }, catalogPaths);
}

export function registerExportRoutes(app: FastifyInstance, db: Db): void {
  app.get("/export.csv", async (request, reply) => {
    const parsedQuery = ExportQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      reply.code(400).send({ error: "invalid query" });
      return;
    }
    const query = parsedQuery.data;
    const columns = resolveColumns(query.columns);

    let mongoQuery;
    try {
      const catalogPaths = await loadCatalogPaths(db);
      mongoQuery = parseFiltersAndQuery(query, catalogPaths);
    } catch (err) {
      if (err instanceof InvalidFilterError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      throw err;
    }

    const cursor = db.collection("call_events").find(mongoQuery).sort({ start_utc: -1 });

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="calls.csv"',
    });
    reply.raw.write(`${columns.map(csvEscape).join(",")}\n`);
    for await (const doc of cursor) {
      const cells = columns.map((col) => {
        const value = getColumnValue(doc, col);
        return PHONE_COLUMNS.has(col) ? csvPhoneCell(value, query.excelTab) : csvEscape(value);
      });
      reply.raw.write(`${cells.join(",")}\n`);
    }
    reply.raw.end();
  });

  app.get("/export.xlsx", async (request, reply) => {
    const parsedQuery = ExportQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      reply.code(400).send({ error: "invalid query" });
      return;
    }
    const query = parsedQuery.data;
    const columns = resolveColumns(query.columns);

    let mongoQuery;
    try {
      const catalogPaths = await loadCatalogPaths(db);
      mongoQuery = parseFiltersAndQuery(query, catalogPaths);
    } catch (err) {
      if (err instanceof InvalidFilterError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      throw err;
    }

    const cursor = db.collection("call_events").find(mongoQuery).sort({ start_utc: -1 });

    reply.hijack();
    reply.raw.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.raw.setHeader("content-disposition", 'attachment; filename="calls.xlsx"');

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: reply.raw });
    const sheet = workbook.addWorksheet("Calls");
    sheet.columns = columns.map((col) => ({
      header: col,
      key: col,
      style: PHONE_COLUMNS.has(col) ? { numFmt: "@" } : undefined,
    }));

    for await (const doc of cursor) {
      const rowValues: Record<string, unknown> = {};
      for (const col of columns) {
        const value = getColumnValue(doc, col);
        rowValues[col] = PHONE_COLUMNS.has(col) ? (value === null || value === undefined ? "" : String(value)) : value;
      }
      sheet.addRow(rowValues).commit();
    }

    sheet.commit();
    await workbook.commit();
    reply.raw.end();
  });
}
