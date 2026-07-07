import { useParams, Link } from "react-router-dom";
import { useScopedInvoices } from "../data/useInvoices.js";
import { StatusPill, Card, fmtAed } from "../components/ui.jsx";

// 5-corner lifecycle steps (per PROJECT_OVERVIEW.md). We mark which are done based on status.
const STEPS = [
  { key: "submitted", label: "Submitted to TCA", desc: "Corner 1 → Corner 2" },
  { key: "validated", label: "Validated (PINT-AE)", desc: "Structural + business rules" },
  { key: "transmitted", label: "Transmitted via Peppol", desc: "Corner 3 → Corner 4 (AS4)" },
  { key: "fta", label: "FTA-acknowledged", desc: "Corner 5 — Tax Data Document" },
];

function reached(status, stepKey) {
  const order = { submitted: 1, validation_failed: 1, transmitted: 3, fta_acknowledged: 4, rejected: 2 };
  const stepOrder = { submitted: 1, validated: 2, transmitted: 3, fta: 4 };
  return (order[status] || 0) >= stepOrder[stepKey];
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const decoded = decodeURIComponent(id);
  // useScopedInvoices enforces RLS — a user can't open another tenant's invoice by URL.
  const rows = useScopedInvoices({ search: decoded });
  const inv = rows.find((r) => r.client_invoice_id === decoded);

  if (!inv) {
    return (
      <div className="placeholder">
        <h3>Invoice not found</h3>
        <p>It may not exist, or it belongs to a tenant outside your access scope.</p>
        <Link to="/invoices">← Back to invoices</Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/invoices" style={{ color: "var(--brand)", fontSize: 13 }}>← Back to invoices</Link>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <Card title="Invoice">
          <table>
            <tbody>
              <Row k="Invoice ID" v={<span className="mono">{inv.client_invoice_id}</span>} />
              <Row k="Status" v={<StatusPill status={inv.status} />} />
              <Row k="Direction" v={inv.direction === "AR" ? "AR (Sales / Outbound)" : "AP (Purchase / Inbound)"} />
              <Row k="Value" v={inv.value_aed != null ? fmtAed(inv.value_aed) : "—"} />
              <Row k="Error code" v={inv.error_code || "—"} />
              <Row k="Channel" v={inv.channel_name} />
            </tbody>
          </table>
        </Card>
        <Card title="Parties">
          <table>
            <tbody>
              <Row k="Supplier (tenant)" v={inv.tenant_name} />
              <Row k="Group" v={inv.group_account_name} />
              <Row k="Supplier TRN" v={<span className="mono">{inv.trn}</span>} />
              <Row k="Buyer" v={inv.buyer_name} />
              <Row k="Buyer country" v={inv.buyer_country || "—"} />
              <Row k="Buyer on Peppol" v={inv.is_peppol_registered ? "Yes" : "No — interop gap"} />
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Compliance lifecycle (5-corner)">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {STEPS.map((s) => {
            const done = reached(inv.status, s.key);
            const isFailHere = (inv.status === "validation_failed" && s.key === "validated") ||
              (inv.status === "rejected" && s.key === "transmitted");
            return (
              <div key={s.key} style={{
                flex: "1 1 180px", border: "1px solid var(--line)", borderRadius: 10, padding: 12,
                background: isFailHere ? "#fbe3e1" : done ? "#dff4ea" : "#fafbff",
              }}>
                <div style={{ fontWeight: 700 }}>
                  {isFailHere ? "✗" : done ? "✓" : "○"} {s.label}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{s.desc}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function Row({ k, v }) {
  return (
    <tr>
      <td style={{ color: "var(--muted)", width: 160 }}>{k}</td>
      <td>{v}</td>
    </tr>
  );
}
