import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useScopedInvoices } from "../data/useInvoices.js";
import { StatusPill, fmtAed, fmt } from "../components/ui.jsx";

const PAGE = 25;

export default function Invoices() {
  const { allowedTenants } = useAuth();
  const [tenantId, setTenantId] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const rows = useScopedInvoices({ tenantId, direction, status, search });
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1)),
    [rows]
  );
  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(sorted.length / PAGE);

  return (
    <>
      <div className="filters">
        <input
          type="search" placeholder="Search invoice id, buyer, tenant…" className="grow"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(0); }}>
          <option value="">All my tenants</option>
          {allowedTenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>)}
        </select>
        <select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(0); }}>
          <option value="">AR + AP</option>
          <option value="AR">AR (Sales)</option>
          <option value="AP">AP (Purchase)</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">All statuses</option>
          <option value="fta_acknowledged">FTA-acknowledged</option>
          <option value="transmitted">Transmitted</option>
          <option value="submitted">Submitted</option>
          <option value="validation_failed">Validation failed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Tenant</th>
              <th>Dir</th>
              <th>Buyer</th>
              <th className="right">Value</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.tenant_id + r.client_invoice_id}>
                <td className="mono">
                  <Link to={`/invoices/${encodeURIComponent(r.client_invoice_id)}`}>{r.client_invoice_id}</Link>
                </td>
                <td>{r.tenant_name}</td>
                <td>{r.direction}</td>
                <td>{r.buyer_name}</td>
                <td className="right">{r.value_aed != null ? fmtAed(r.value_aed) : "—"}</td>
                <td><StatusPill status={r.status} /></td>
                <td>{(r.submitted_at || "").slice(0, 10)}</td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td colSpan={7} className="empty">No invoices match your filters / scope.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", fontSize: 13 }}>
        <span>{fmt(sorted.length)} invoices</span>
        <div style={{ flex: 1 }} />
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
        <span>Page {page + 1} / {Math.max(pages, 1)}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next ›</button>
      </div>
    </>
  );
}
