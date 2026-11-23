import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { api, buildExportUrl, type CallEvent, type Filter } from "../lib/api.js";
import FilterBuilder from "./FilterBuilder.js";
import CallDetailDrawer from "./CallDetailDrawer.js";

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function getColumnValue(row: CallEvent, column: string): unknown {
  if (column in row) return row[column];
  return getByPath(row.data, column);
}

function formatCell(column: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (column.endsWith("_utc")) {
    const d = new Date(value as string);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

const columnHelper = createColumnHelper<CallEvent>();

/**
 * Shared table/filter/export UI behind both the Calls tab and the Website
 * Events tab - the two differ only in which action(s) they're locked to and
 * which columns make sense by default; every promoted field is uniform across
 * action families (src/lib/normalize.ts), so no other logic needs to differ.
 */
export default function CallsExplorer({
  defaultColumns,
  fixedFilters = [],
}: {
  defaultColumns: string[];
  fixedFilters?: Filter[];
}) {
  const [market, setMarket] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [adName, setAdName] = useState("");
  const [channel, setChannel] = useState("");
  const [action, setAction] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [columns, setColumns] = useState<string[]>(defaultColumns);
  const [sort, setSort] = useState("start_utc");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [excelTab, setExcelTab] = useState(false);

  const catalogQuery = useQuery({ queryKey: ["field-catalog"], queryFn: api.fieldCatalog });
  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });
  const filterOptionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });

  const availablePaths = useMemo(() => {
    const catalogPaths = catalogQuery.data?.entries.map((e) => e.path) ?? [];
    return Array.from(new Set([...defaultColumns, ...catalogPaths])).sort();
  }, [catalogQuery.data, defaultColumns]);

  // The Website Events tab locks "action" via fixedFilters already - showing a
  // second, user-editable Action dropdown there would just contradict it (two
  // "equals" clauses on the same field can never both match).
  const hasFixedAction = fixedFilters.some((f) => f.path === "action");

  // UTM Source / Ad Name / Channel / Action are dedicated dropdowns (like
  // Market) rather than buried in the generic filter builder below, since
  // they're common dimensions users reach for constantly.
  const dropdownFilters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (utmSource) f.push({ path: "utm_source", operator: "equals", value: utmSource });
    if (adName) f.push({ path: "ad_name", operator: "equals", value: adName });
    if (channel) f.push({ path: "channel", operator: "equals", value: channel });
    if (action && !hasFixedAction) f.push({ path: "action", operator: "equals", value: action });
    return f;
  }, [utmSource, adName, channel, action, hasFixedAction]);

  const allFilters = useMemo(() => [...fixedFilters, ...dropdownFilters, ...filters], [fixedFilters, dropdownFilters, filters]);

  function buildListParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());
    if (allFilters.length > 0) params.set("filters", JSON.stringify(allFilters));
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params;
  }

  function buildExportParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());
    if (allFilters.length > 0) params.set("filters", JSON.stringify(allFilters));
    params.set("columns", columns.join(","));
    if (excelTab) params.set("excelTab", "true");
    return params;
  }

  const callsQuery = useQuery({
    queryKey: ["calls", market, dateFrom, dateTo, allFilters, sort, dir, page, pageSize],
    queryFn: () => api.calls(buildListParams()),
  });

  const tableColumns = useMemo(
    () =>
      columns.map((col) =>
        columnHelper.accessor((row) => getColumnValue(row, col), {
          id: col,
          header: col,
          cell: (info) => formatCell(col, info.getValue()),
        }),
      ),
    [columns],
  );

  const table = useReactTable({
    data: callsQuery.data?.rows ?? [],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = callsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(columnId: string) {
    if (sort === columnId) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(columnId);
      setDir("desc");
    }
    setPage(1);
  }

  function toggleColumn(path: string) {
    setColumns((prev) => (prev.includes(path) ? prev.filter((c) => c !== path) : [...prev, path]));
  }

  return (
    <div>
      <div className="toolbar">
        <div className="field">
          <label>Market</label>
          <select value={market} onChange={(e) => { setMarket(e.target.value); setPage(1); }}>
            <option value="">All markets</option>
            {marketsQuery.data?.markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        <div className="field">
          <label>UTM Source</label>
          <select value={utmSource} onChange={(e) => { setUtmSource(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.utmSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Ad Name</label>
          <select value={adName} onChange={(e) => { setAdName(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.adNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Channel</label>
          <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            {filterOptionsQuery.data?.channels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {!hasFixedAction && (
          <div className="field">
            <label>Action</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">Any</option>
              {filterOptionsQuery.data?.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Columns</label>
          <details>
            <summary>{columns.length} selected</summary>
            <div style={{ maxHeight: 200, overflow: "auto", background: "white", border: "1px solid #ddd", padding: 6 }}>
              {availablePaths.map((p) => (
                <label key={p} style={{ display: "block", fontSize: 12 }}>
                  <input type="checkbox" checked={columns.includes(p)} onChange={() => toggleColumn(p)} /> {p}
                </label>
              ))}
            </div>
          </details>
        </div>
        <div className="field">
          <label>Export</label>
          <div className="flex-row">
            <a href={buildExportUrl("csv", buildExportParams())}>
              <button type="button">CSV</button>
            </a>
            <a href={buildExportUrl("xlsx", buildExportParams())}>
              <button type="button">XLSX</button>
            </a>
          </div>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={excelTab} onChange={(e) => setExcelTab(e.target.checked)} /> Prefix phone
            numbers with tab (Excel)
          </label>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Filters</h3>
        <FilterBuilder filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} paths={availablePaths} />
      </div>

      {callsQuery.isLoading && <p>Loading...</p>}
      {callsQuery.isError && <p className="error-text">Failed to load calls.</p>}

      {callsQuery.data && (
        <>
          <table>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id} onClick={() => toggleSort(header.column.id)}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sort === header.column.id ? (dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="clickable" onClick={() => setSelectedCallId(row.original._id)}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages} ({total} rows)
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}

      {selectedCallId && <CallDetailDrawer id={selectedCallId} onClose={() => setSelectedCallId(null)} />}
    </div>
  );
}
