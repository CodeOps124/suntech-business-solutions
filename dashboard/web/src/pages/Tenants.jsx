import { useAuth } from "../auth/AuthContext.jsx";
import { useScopedInvoices, kpis } from "../data/useInvoices.js";
import { fmt, fmtAed } from "../components/ui.jsx";

export default function Tenants() {
  const { allowedTenants } = useAuth();
  const rows = useScopedInvoices();

  const perTenant = allowedTenants.map((t) => {
    const tr = rows.filter((r) => r.tenant_id === t.tenant_id);
    const k = kpis(tr);
    return { ...t, ...k };
  });

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Legal Entity</th>
            <th>Group</th>
            <th>TRN</th>
            <th>Tier</th>
            <th className="right">Processed</th>
            <th className="right">Rejection %</th>
            <th className="right">Processed Value</th>
          </tr>
        </thead>
        <tbody>
          {perTenant.map((t) => (
            <tr key={t.tenant_id}>
              <td>{t.tenant_name}</td>
              <td>{t.group_account_name}</td>
              <td className="mono">{t.trn}</td>
              <td><span className="pill neutral">{t.integration_tier}</span></td>
              <td className="right">{fmt(t.processed)}</td>
              <td className="right">{t.rejectionRate.toFixed(1)}%</td>
              <td className="right">{t.hasValue ? fmtAed(t.processedValue) : "—"}</td>
            </tr>
          ))}
          {!perTenant.length && (
            <tr><td colSpan={7} className="empty">No legal entities in your access scope.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
