import { useState } from "react";
import { useCustomers, useScopedSuppliers, useItems } from "../data/useMasterData.js";
import { Card, fmt, fmtAed } from "../components/ui.jsx";

const TABS = ["Customers", "Legal Entities (suppliers)", "Item Catalogue"];

export default function MasterData() {
  const [tab, setTab] = useState(0);
  return (
    <>
      <Card hint="Master data is the source of truth the Gap Analyzer uses to auto-fill incomplete invoices — it is never generated, only retrieved. Records here are scoped to the entities you can access.">
        <div className="tabs" style={{ margin: 0, borderBottom: "none" }}>
          {TABS.map((t, i) => (
            <div key={t} className={"tab" + (i === tab ? " active" : "")} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
      </Card>
      {tab === 0 && <Customers />}
      {tab === 1 && <Suppliers />}
      {tab === 2 && <Items />}
    </>
  );
}

function Customers() {
  const customers = useCustomers();
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Customer (buyer)</th><th>Country</th><th>Peppol</th>
            <th className="right">Invoices</th><th className="right">Value</th><th className="right">Used by</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.buyer_id}>
              <td>{c.buyer_name}</td>
              <td>{c.buyer_country || "—"}</td>
              <td>
                {c.is_peppol_registered
                  ? <span className="pill ok">On network</span>
                  : <span className="pill bad">Not registered</span>}
              </td>
              <td className="right">{fmt(c.invoices)}</td>
              <td className="right">{fmtAed(c.value)}</td>
              <td className="right">{c.tenant_count} entit{c.tenant_count === 1 ? "y" : "ies"}</td>
            </tr>
          ))}
          {!customers.length && <tr><td colSpan={6} className="empty">No customers in scope.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Suppliers() {
  const suppliers = useScopedSuppliers();
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Legal Entity</th><th>TRN</th><th>Trade Licence</th><th>Registered Address</th>
            <th className="right">Data readiness</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr key={s.tenant_id}>
              <td>{s.tenant_name}<div style={{ color: "var(--muted)", fontSize: 12 }}>{s.group_account_name} · {s.integration_tier}</div></td>
              <td className="mono">{s.trn}</td>
              <td className="mono">{s.trade_licence}</td>
              <td style={{ fontSize: 12 }}>{s.address}</td>
              <td className="right">
                <Readiness pct={s.master_data_completeness} />
              </td>
            </tr>
          ))}
          {!suppliers.length && <tr><td colSpan={5} className="empty">No legal entities in scope.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Readiness({ pct }) {
  const cls = pct >= 95 ? "ok" : pct >= 85 ? "mid" : "bad";
  return (
    <span title="Master-data completeness (drives Gap Analyzer fills)">
      <span className={`pill ${cls}`}>{pct}%</span>
    </span>
  );
}

function Items() {
  const items = useItems();
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr><th>Item code</th><th>Name</th><th>UAE tax category</th><th>Unit</th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.item_code}>
              <td className="mono">{it.item_code}</td>
              <td>{it.name}</td>
              <td><span className="pill neutral">{it.tax_category}</span></td>
              <td>{it.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
