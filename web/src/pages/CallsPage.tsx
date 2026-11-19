import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { api, buildExportUrl, type CallEvent, type Filter } from "../lib/api.js";
import FilterBuilder from "../components/FilterBuilder.js";
import CallDetailDrawer from "../components/CallDetailDrawer.js";

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

export default function CallsPage() {
  const [market, setMarket] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState("start_utc");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [excelTab, setExcelTab] = useState(false);

  const catalogQuery = useQuery({ queryKey: ["field-catalog"], queryFn: api.fieldCatalog });
  const marketsQuery = useQuery({ queryKey: ["markets"], queryFn: api.markets });

  const availablePaths = useMemo(() => {
    const catalogPaths = catalogQuery.data?.entries.map((e) => e.path) ?? [];
    return Array.from(new Set([...DEFAULT_COLUMNS, ...catalogPaths])).sort();
  }, [catalogQuery.data]);

  function buildListParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) params.set("dateTo", new Date(dateTo).toISOString());
    if (filters.length > 0) params.set("filters", JSON.stringify(filters));
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
    if (filters.length > 0) params.set("filters", JSON.stringify(filters));
    params.set("columns", columns.join(","));
    if (excelTab) params.set("excelTab", "true");
    return params;
  }

  const callsQuery = useQuery({
    queryKey: ["calls", market, dateFrom, dateTo, filters, sort, dir, page, pageSize],
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
