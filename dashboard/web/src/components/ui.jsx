import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

export const BRAND = "#1a1aa6";
const PALETTE = ["#1a1aa6", "#4f8df9", "#15a06b", "#d98a00", "#d4453b", "#8a5cf6", "#0ea5b7", "#9ca3af"];

export function fmt(n) {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}
export function fmtAed(n) {
  return "AED " + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

export function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, hint, children }) {
  return (
    <div className="card">
      {title && <h3>{title}</h3>}
      {hint && <div className="hint">{hint}</div>}
      {children}
    </div>
  );
}

export function HBar({ data, color = BRAND, height = 280, money = false }) {
  if (!data.length) return <div className="empty">No data in scope</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={fmt} />
        {/* reversed: with layout="vertical" Recharts puts array[0] at the bottom.
            Our data arrives sorted descending, so reverse the category axis to
            render the largest value at the TOP (standard ranked-bar order). */}
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} reversed />
        <Tooltip formatter={(v) => (money ? fmtAed(v) : fmt(v))} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VBar({ data, color = BRAND, height = 280 }) {
  if (!data.length) return <div className="empty">No data in scope</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmt} />
        <Tooltip formatter={(v) => fmt(v)} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Trend({ data, keys, height = 280 }) {
  if (!data.length) return <div className="empty">No data in scope</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmt} />
        <Tooltip formatter={(v) => fmt(v)} />
        <Legend />
        {keys.map((k, i) => (
          <Line key={k.key} type="monotone" dataKey={k.key} name={k.label}
            stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 280 }) {
  if (!data.length) return <div className="empty">No data in scope</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => fmt(v)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

const STATUS_CLASS = {
  fta_acknowledged: "ok",
  transmitted: "mid",
  submitted: "neutral",
  validation_failed: "bad",
  rejected: "bad",
};
const STATUS_LABEL = {
  fta_acknowledged: "FTA-acknowledged",
  transmitted: "Transmitted",
  submitted: "Submitted",
  validation_failed: "Validation failed",
  rejected: "Rejected",
};
export function StatusPill({ status }) {
  return <span className={`pill ${STATUS_CLASS[status] || "neutral"}`}>{STATUS_LABEL[status] || status}</span>;
}
