import type { Filter } from "../lib/api.js";

const OPERATORS: { id: Filter["operator"]; label: string }[] = [
  { id: "equals", label: "=" },
  { id: "not_equals", label: "!=" },
  { id: "contains", label: "contains" },
  { id: "in", label: "in (comma-separated)" },
  { id: "exists", label: "exists" },
  { id: "gt", label: ">" },
  { id: "lt", label: "<" },
  { id: "between", label: "between (min,max)" },
];

function valueToInputString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

function parseValueForOperator(operator: Filter["operator"], raw: string): unknown {
  if (operator === "exists") return raw === "true";
  if (operator === "in") return raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (operator === "between") {
    const [min, max] = raw.split(",").map((v) => v.trim());
    return [min ?? "", max ?? ""];
  }
  return raw;
}

export default function FilterBuilder({
  filters,
  onChange,
  paths,
}: {
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  paths: string[];
}) {
  function updateFilter(index: number, patch: Partial<Filter>) {
    const next = filters.slice();
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  }

  function removeFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index));
  }

  function addFilter() {
    onChange([...filters, { path: paths[0] ?? "", operator: "equals", value: "" }]);
  }

  return (
    <div>
      {filters.map((filter, index) => (
        <div className="filter-row" key={index}>
          <select value={filter.path} onChange={(e) => updateFilter(index, { path: e.target.value })}>
            {paths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={filter.operator}
            onChange={(e) => updateFilter(index, { operator: e.target.value as Filter["operator"] })}
          >
            {OPERATORS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
          {filter.operator === "exists" ? (
            <select value={String(filter.value)} onChange={(e) => updateFilter(index, { value: e.target.value === "true" })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              value={valueToInputString(filter.value)}
              onChange={(e) => updateFilter(index, { value: parseValueForOperator(filter.operator, e.target.value) })}
              placeholder={filter.operator === "between" ? "min,max" : filter.operator === "in" ? "a,b,c" : "value"}
            />
          )}
          <button className="danger" type="button" onClick={() => removeFilter(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={addFilter} disabled={paths.length === 0}>
        + Add filter
      </button>
    </div>
  );
}
