// Small hand-rolled inline-SVG charts - no charting library dependency. Good
// enough for the Dashboard/Numbers tabs' stat visuals without needing to stop
// and get a new-dependency approval for something CSS/SVG can already do.

const BAR_COLOR = "#2563eb";
const BAR_COLOR_MUTED = "#93c5fd";

export function BarChart({
  data,
  width = 560,
  height = 160,
  color = BAR_COLOR,
  formatLabel,
}: {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
  formatLabel?: (label: string) => string;
}) {
  if (data.length === 0) return <p className="hint">No data for these filters.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = width / data.length;
  const chartHeight = height - 24;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="img">
      {data.map((d, i) => {
        const barHeight = (d.value / max) * chartHeight;
        const x = i * barWidth + barWidth * 0.15;
        const w = barWidth * 0.7;
        const y = chartHeight - barHeight;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={w} height={Math.max(barHeight, d.value > 0 ? 2 : 0)} fill={color}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text x={x + w / 2} y={chartHeight + 14} textAnchor="middle" fontSize="9" fill="#555">
              {formatLabel ? formatLabel(d.label) : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({
  data,
  width = 560,
  height = 160,
  color = BAR_COLOR,
}: {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length === 0) return <p className="hint">No data for these filters.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const chartHeight = height - 24;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = data.length > 1 ? i * stepX : width / 2;
    const y = chartHeight - (d.value / max) * chartHeight;
    return { x, y, d };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  // Show at most ~8 x-axis labels so dense date ranges don't overlap.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="img">
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {points.map((p, i) => (
        <g key={p.d.label}>
          <circle cx={p.x} cy={p.y} r={2.5} fill={color}>
            <title>{`${p.d.label}: ${p.d.value}`}</title>
          </circle>
          {i % labelEvery === 0 && (
            <text x={p.x} y={chartHeight + 14} textAnchor="middle" fontSize="9" fill="#555">
              {p.d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** A single stacked horizontal bar showing a 2-way split (e.g. answered/missed, paid/organic). */
export function SplitBar({
  left,
  right,
  leftColor = BAR_COLOR,
  rightColor = "#e5e7eb",
}: {
  left: { label: string; value: number };
  right: { label: string; value: number };
  leftColor?: string;
  rightColor?: string;
}) {
  const total = left.value + right.value;
  const leftPercent = total > 0 ? (left.value / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", background: rightColor }}>
        <div style={{ width: `${leftPercent}%`, background: leftColor }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4, color: "#555" }}>
        <span>
          {left.label}: {left.value} ({leftPercent.toFixed(0)}%)
        </span>
        <span>
          {right.label}: {right.value} ({(100 - leftPercent).toFixed(0)}%)
        </span>
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ minWidth: 160 }}>
      <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#888" }}>{sub}</div>}
    </div>
  );
}

export { BAR_COLOR, BAR_COLOR_MUTED };
