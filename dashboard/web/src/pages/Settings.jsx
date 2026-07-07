import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useScopedSuppliers } from "../data/useMasterData.js";
import { Card } from "../components/ui.jsx";
import { connectionStatus } from "../config.js";

const RECEIVE_CHANNELS = [
  "User Portal (default)",
  "ERP push (Embedded only)",
  "Webhook callback",
  "SFTP file drop",
  "Email + portal link",
];

const TABS = ["AWS Connection", "Integration & Channels", "Users & Access (RLS)", "Compliance & Residency"];

export default function Settings() {
  const [tab, setTab] = useState(0);
  return (
    <>
      <Card hint="Configuration for the legal entities you administer. Changes here are scoped to your access; cross-tenant settings require a parent-group admin.">
        <div className="tabs" style={{ margin: 0, borderBottom: "none" }}>
          {TABS.map((t, i) => (
            <div key={t} className={"tab" + (i === tab ? " active" : "")} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
      </Card>
      {tab === 0 && <AwsConnection />}
      {tab === 1 && <Integration />}
      {tab === 2 && <Users />}
      {tab === 3 && <Compliance />}
    </>
  );
}

function AwsConnection() {
  const { connected, checks, regionOk, region } = connectionStatus();
  return (
    <>
      <Card title="QuickSight connection status"
        hint="Live status of the AWS QuickSight embed. Each item is set via an env var in .env.local — connecting is config-only, no code change. See web/CONNECT_AWS.md for the full walkthrough.">
        <div style={{ marginBottom: 12 }}>
          <span className={`pill ${connected ? "ok" : "bad"}`} style={{ fontSize: 13 }}>
            {connected ? "● Connected — live QuickSight embed active" : "○ Not connected — running on local sample data"}
          </span>
          {region && !regionOk && (
            <span className="pill bad" style={{ marginLeft: 8 }}>
              Region must be me-central-1 (data residency)
            </span>
          )}
        </div>
        <table>
          <thead><tr><th>Requirement</th><th>Status</th><th>Value</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}<div style={{ color: "var(--muted)", fontSize: 12 }}>{c.hint}</div></td>
                <td>{c.ok ? <span className="pill ok">set</span> : <span className="pill bad">missing</span>}</td>
                <td className="mono" style={{ fontSize: 12 }}>{c.value || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="How to connect real AWS QuickSight">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Deploy the dashboard infra + QuickSight assets — see <span className="mono">dashboard/docs/DEPLOY.md</span> (region <b>me-central-1</b>).</li>
          <li>Run the embed-URL backend with your AWS credentials — see <span className="mono">dashboard/web/server/</span> (it calls QuickSight <span className="mono">generateEmbedUrlForRegisteredUser</span>, scoped per principal so RLS applies server-side).</li>
          <li>Copy <span className="mono">.env.example</span> → <span className="mono">.env.local</span>, fill in region, account id, dashboard id, and the embed endpoint URL.</li>
          <li>Restart the dev server. This panel flips to <b>Connected</b> and the Analytics tab renders the live dashboard.</li>
        </ol>
      </Card>
    </>
  );
}

function Integration() {
  const suppliers = useScopedSuppliers();
  // receive channel selection per tenant, local state (would persist via API).
  const [channels, setChannels] = useState({});
  const setChan = (tid, val) => setChannels((p) => ({ ...p, [tid]: val }));

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr><th>Legal Entity</th><th>Send method (tier)</th><th>Receive channel</th><th>Status</th></tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr key={s.tenant_id}>
              <td>{s.tenant_name}<div style={{ color: "var(--muted)", fontSize: 12 }}>{s.group_account_name}</div></td>
              <td><span className="pill neutral">{s.integration_tier}</span></td>
              <td>
                <select value={channels[s.tenant_id] || RECEIVE_CHANNELS[0]} onChange={(e) => setChan(s.tenant_id, e.target.value)}>
                  {RECEIVE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td><span className="pill ok">Live</span></td>
            </tr>
          ))}
          {!suppliers.length && <tr><td colSpan={4} className="empty">No entities in scope.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Users() {
  const { personas, allowedTenants, persona } = useAuth();
  return (
    <>
      <Card title="Your access scope"
        hint="This reflects the dataset-layer RLS. You see exactly the entities granted to your principal — internal P&L leads can be granted a whole group; client users get a single tenant.">
        <p style={{ margin: "0 0 6px" }}>
          Signed in as <b>{persona.label}</b>
        </p>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          {allowedTenants.length} entit{allowedTenants.length === 1 ? "y" : "ies"} in scope:{" "}
          {allowedTenants.map((t) => t.tenant_name).join(", ") || "(none)"}
        </p>
      </Card>

      <Card title="RLS principals (demo personas)"
        hint="In production these come from SSO / IAM Identity Center; grants live in the rls_user_grant table and feed the QuickSight RLS dataset.">
        <table>
          <thead><tr><th>Principal</th><th>Role</th><th>Scope</th></tr></thead>
          <tbody>
            {personas.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>{p.role}</td>
                <td>{p.scope === "all" ? "All tenants (admin grant)" : "RLS-restricted"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Compliance() {
  const items = [
    ["Data residency", "AWS me-central-1 (UAE / Dubai)"],
    ["Encryption at rest", "Application-level envelope encryption + AWS KMS"],
    ["Encryption in transit", "TLS 1.2+ on every channel"],
    ["Authentication", "SSO / IAM Identity Center; MFA mandatory for admins"],
    ["Row-level security", "Enforced at the dataset/data layer (not UI-only)"],
    ["DLQ retention", "30 days, accessible via Portal & API"],
    ["ASP accreditation", "UAE FTA-accredited; Peppol AP/SMP certified"],
  ];
  return (
    <Card title="Compliance & residency (read-only)"
      hint="Suntech-owned obligations that apply to every tenant regardless of integration method.">
      <table>
        <tbody>
          {items.map(([k, v]) => (
            <tr key={k}><td style={{ color: "var(--muted)", width: 220 }}>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
