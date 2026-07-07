import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useScopedInvoices, kpis } from "../data/useInvoices.js";
import { Card, StatusPill, VBar, fmt, fmtAed } from "../components/ui.jsx";

const NOW = new Date("2026-06-18T00:00:00Z"); // fixed reference date — keep in sync with etl/generate_sample_data.py END_DATE
const BUCKETS = [
  { label: "0–7 days", max: 7 },
  { label: "8–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "61–90 days", max: 90 },
  { label: "90+ days", max: Infinity },
];

function ageDays(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((NOW - new Date(iso)) / 86400000));
}

/**
 * Shared AR/AP ledger. direction="AR" → Receivables (sales/outbound),
 * direction="AP" → Payables (purchase/inbound). Shows KPIs, an aging
 * distribution (by submission age, a proxy for processing age in this dataset),
 * and the line-item list — all tenant-scoped.
 */
export default function Ledger({ direction, title, counterpartyLabel }) {
  const { allowedTenants } = useAuth();
  const [tenantId, setTenantId] = useState("");
  const rows = useScopedInvoices({ direction, tenantId });
  const k = kpis(rows);

  const aging = useMemo(() => {
    const out = BUCKETS.map((b) => ({ name: b.label, value: 0 }));
    for (const r of rows) {
      const d = ageDays(r.submitted_at);
      const idx = BUCKETS.findIndex((b) => d <= b.max);
      out[idx].value += 1;
    }
    return out;
  }, [rows]);

  const recent = useMemo(
    () => [...rows].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1)).slice(0, 50),
    [rows]
  );

  return (
    <>
      <div className="filters">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">All my tenants</option>
          {allowedTenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>)}
        </select>
        <div className="grow" />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{fmt(rows.length)} {direction} invoices in scope</span>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">{title} — total</div><div className="value">{fmt(k.total)}</div></div>
        <div className="kpi"><div className="label">Processed (cleared)</div><div className="value" style={{ color: "var(--good)" }}>{fmt(k.processed)}</div></div>
        <div className="kpi"><div className="label">Open / unresolved</div><div className="value">{fmt(k.total - k.processed)}</div></div>
        <div className="kpi"><div className="label">Total value</div><div className="value">{k.hasValue ? fmtAed(k.processedValue) : "—"}</div></div>
      </div>

      <Card title="Aging distribution" hint="By submission age — a proxy for time in the compliance pipeline.">
        <VBar data={aging} color={direction === "AR" ? "#1a1aa6" : "#0ea5b7"} height={240} />
      </Card>

      <Card title={`Recent ${title} invoices`}>
        <div style={{ marginTop: -6 }}>
          <table>
            <thead>
              <tr>
                <th>Invoice</th><th>Tenant</th><th>{counterpartyLabel}</th>
                <th className="right">Value</th><th className="right">Age</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.tenant_id + r.client_invoice_id}>
                  <td className="mono"><Link to={`/invoices/${encodeURIComponent(r.client_invoice_id)}`}>{r.client_invoice_id}</Link></td>
                  <td>{r.tenant_name}</td>
                  <td>{r.buyer_name}</td>
                  <td className="right">{r.value_aed != null ? fmtAed(r.value_aed) : "—"}</td>
                  <td className="right">{ageDays(r.submitted_at)}d</td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={6} className="empty">No {direction} invoices in scope.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
