import type { FastifyInstance } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { buildCallsQuery, loadCatalogPaths, resolveSortField, InvalidFilterError, OPERATORS } from "../../lib/queryBuilder.js";

const FilterSchema = z.object({
  path: z.string().min(1).max(300),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

const CallsQuerySchema = z.object({
  market: z.string().min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  filters: z.string().optional(),
});

function parseFilters(raw: string | undefined): z.infer<typeof FilterSchema>[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidFilterError("filters must be valid JSON");
  }
  const result = z.array(FilterSchema).safeParse(parsed);
  if (!result.success) {
    throw new InvalidFilterError("filters must be an array of { path, operator, value }");
  }
  return result.data;
}

export function registerCallsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/calls", async (request, reply) => {
    const parsedQuery = CallsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      reply.code(400).send({ error: "invalid query", details: parsedQuery.error.flatten() });
      return;
    }
    const query = parsedQuery.data;

    try {
      const filters = parseFilters(query.filters);
      const catalogPaths = await loadCatalogPaths(db);
      const mongoQuery = buildCallsQuery(
        { market: query.market, dateFrom: query.dateFrom, dateTo: query.dateTo, filters },
        catalogPaths,
      );
      const sortField = resolveSortField(query.sort, catalogPaths);
      const sortDir = query.dir === "asc" ? 1 : -1;

      const cursor = db
        .collection("call_events")
        .find(mongoQuery)
        .sort({ [sortField]: sortDir })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize);

      const [rows, total] = await Promise.all([
        cursor.toArray(),
        db.collection("call_events").countDocuments(mongoQuery),
      ]);

      reply.send({ rows, total, page: query.page, pageSize: query.pageSize });
    } catch (err) {
      if (err instanceof InvalidFilterError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/calls/:id", async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    const event = await db.collection("call_events").findOne({ _id: new ObjectId(request.params.id) });
    if (!event) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const linked = event.linked_event_id
      ? await db.collection("call_events").findOne({ _id: event.linked_event_id })
      : null;

    reply.send({ event, linked });
  });
}
