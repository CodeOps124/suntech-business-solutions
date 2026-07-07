import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import {
  useScopedInvoices, kpis, groupCount, sortDesc, monthlyTrend,
} from "../data/useInvoices.js";
import { Kpi, Card, HBar, VBar, Trend, Donut, fmt, fmtAed } from "../components/ui.jsx";
import { isEmbedConfigured, getEmbedUrl, embedDashboard } from "../quicksight/embed.js";
import { connectionStatus } from "../config.js";

const TABS = ["Executive Overview", "Tenant Explorer", "Operational Health", "Commercial"];

export default function Analytics() {
  const { allowedTenants, persona } = useAuth();
  const [tab, setTab] = useState(0);
  const [tenantId, setTenantId] = useState("");
  const [direction, setDirection] = useState("");

  const rows = useScopedInvoices({ tenantId, direction });

  return (
    <>
      <EmbedBanner />
      <div className="filters">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">All my tenants ({allowedTenants.length})</option>
          {allowedTenants.map((t) => (
            <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
          ))}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">AR + AP</option>
          <option value="AR">AR (Sales / Outbound)</option>
          <option value="AP">AP (Purchase / Inbound)</option>
        </select>
        <div className="grow" />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {fmt(rows.length)} invoices in scope
        </span>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <div key={t} className={"tab" + (i === tab ? " active" : "")} onClick={() => setTab(i)}>
            {t}
          </div>
        ))}
      </div>

      {tab === 0 && <Executive rows={rows} />}
      {tab === 1 && (
        <TenantExplorer
          rows={rows}
          tenantId={tenantId}
          setTenantId={setTenantId}
          tenants={allowedTenants}
        />
      )}
      {tab === 2 && <OpsHealth rows={rows} />}
      {tab === 3 && <Commercial rows={rows} />}
    </>
  );
}

/* Shows whether we're rendering the live QuickSight embed or the local fallback. */
function EmbedBanner() {
  const { connected, checks } = connectionStatus();
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return (
    <div className="embed-banner">
      <span style={{ fontSize: 18 }}>{connected ? "🔗" : "🧪"}</span>
      <div>
        <b>{connected ? "Live QuickSight embed" : "Local preview mode — AWS QuickSight not connected"}</b>
        {connected ? (
          "Charts below are the embedded Amazon QuickSight dashboard, RLS-scoped to you server-side."
        ) : (
          <>
            Charts render locally from sample data so the product is usable now.
            Missing to go live: <b>{missing.join(", ")}</b>.{" "}
            <Link to="/settings" style={{ textDecoration: "underline" }}>
              Open Settings → AWS Connection
            </Link>{" "}
            for the connect steps.
          </>
        )}
      </div>
    </div>
  );
}

/* If embed is configured, render the real dashboard instead of local charts. */
function useQuickSightEmbed(enabled) {
  const ref = useRef(null);
  const { principalId } = useAuth();
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    let cancelled = false;
    (async () => {
      try {
        const url = await getEmbedUrl(principalId);
        if (!cancelled && url) await embedDashboard(ref.current, url);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, principalId]);
  return { ref, err };
}

function Executive({ rows }) {
  const embedOn = isEmbedConfigured();
  const { ref, err } = useQuickSightEmbed(embedOn);
  const k = kpis(rows);
  const byTier = sortDesc(groupCount(rows, "integration_tier", (r) => r.is_processed));
  const byStatus = sortDesc(groupCount(rows, "status"));
  const topTenants = sortDesc(groupCount(rows, "tenant_name", (r) => r.is_processed), 10);
  const trend = monthlyTrend(rows);

  if (embedOn) {
    return (
      <Card title="Amazon QuickSight — Executive Overview">
        {err && <div className="empty">Embed error: {err}. Falling back requires VITE_QS_EMBED_ENDPOINT to be valid.</div>}
        <div ref={ref} style={{ minHeight: 800 }} />
      </Card>
    );
  }

  return (
    <>
      <div className="kpis">
        <Kpi label="Invoices Processed (FTA-acknowledged)" value={fmt(k.processed)}
          sub={`${fmt(k.total)} total submitted`} />
        <Kpi label="Processed Value" value={k.hasValue ? fmtAed(k.processedValue) : "—"}
          sub={k.hasValue ? "FTA-acknowledged only" : "value data not available"} />
        <Kpi label="Avg Time-to-Acknowledge" value={`${fmt(k.avgTtack)} min`}
          sub="submitted → FTA ack" />
        <Kpi label="Rejection Rate" value={`${k.rejectionRate.toFixed(1)}%`}
          sub={`${fmt(k.failed)} failed / rejected`} />
      </div>
      <div className="grid-2">
        <Card title="Invoice Trend (processed vs failed)">
          <Trend data={trend} keys={[{ key: "processed", label: "Processed" }, { key: "failed", label: "Failed" }]} />
        </Card>
        <Card title="Status Breakdown">
          <Donut data={byStatus} />
        </Card>
        <Card title="Processed by Integration Tier">
          <VBar data={byTier} />
        </Card>
        <Card title="Top Tenants by Processed Volume">
          <HBar data={topTenants} />
        </Card>
      </div>
    </>
  );
}

function TenantExplorer({ rows, tenantId, setTenantId, tenants }) {
  // This page answers "invoices processed for the customers of <tenant>".
  const focused = tenantId
    ? rows
    : rows.filter((r) => r.tenant_id === (tenants[0]?.tenant_id));
  const focusName = (tenants.find((t) => t.tenant_id === tenantId) || tenants[0])?.tenant_name;
  const k = kpis(focused);
  const byBuyer = sortDesc(groupCount(focused, "buyer_name", (r) => r.is_processed));
  const byDir = groupCount(focused, "direction");
  const trend = monthlyTrend(focused);

  return (
    <>
      <Card hint="Pick a tenant to see its volume and a breakdown of its own buyers (its customers). This answers questions like “how many invoices were processed for the customers of PwC?”">
        <div className="filters" style={{ marginBottom: 0 }}>
          <label style={{ alignSelf: "center", color: "var(--muted)" }}>Tenant:</label>
          <select value={tenantId || tenants[0]?.tenant_id || ""} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
            ))}
          </select>
        </div>
      </Card>
      <div className="kpis">
        <Kpi label={`Processed for ${focusName || "—"}`} value={fmt(k.processed)} />
        <Kpi label="Processed Value" value={k.hasValue ? fmtAed(k.processedValue) : "—"} />
        <Kpi label="Distinct Buyers" value={fmt(byBuyer.filter((b) => b.value > 0).length)} sub="this tenant's customers" />
        <Kpi label="Rejection Rate" value={`${k.rejectionRate.toFixed(1)}%`} />
      </div>
      <div className="grid-2">
        <Card title="Processed Invoices by Buyer (this tenant's customers)">
          <HBar data={byBuyer} height={360} />
        </Card>
        <div>
          <Card title="AR / AP Split"><Donut data={byDir} height={200} /></Card>
          <Card title="Processed Trend"><Trend data={trend} keys={[{ key: "processed", label: "Processed" }]} height={200} /></Card>
        </div>
      </div>
    </>
  );
}

function OpsHealth({ rows }) {
  const failed = rows.filter((r) => r.is_failed);
  const byError = sortDesc(groupCount(failed, "error_code"));
  const byChannel = sortDesc(groupCount(failed, "channel_name"));
  const interop = sortDesc(
    groupCount(failed, "is_peppol_registered").map((d) => ({
      name: d.name === true || d.name === "true" ? "Buyer on Peppol" : "Buyer NOT on Peppol",
      value: d.value,
    }))
  );
  const rejTrend = monthlyTrend(rows);

  return (
    <>
      <div className="grid-2">
        <Card title="Rejection / Failure Trend">
          <Trend data={rejTrend} keys={[{ key: "failed", label: "Failed" }]} />
        </Card>
        <Card title="Error Code Breakdown">
          <HBar data={byError} color="#d4453b" />
        </Card>
        <Card title="Failures by Channel">
          <HBar data={byChannel} color="#d98a00" />
        </Card>
        <Card title="Interop Gap — buyer not yet on Peppol"
          hint="Isolates failures caused by the buyer not being Peppol-registered yet — a market-readiness gap, not a Suntech/client error (and a BD lead list).">
          <Donut data={interop} />
        </Card>
      </div>
    </>
  );
}

function Commercial({ rows }) {
  const k = kpis(rows);
  if (!k.hasValue) {
    return (
      <div className="placeholder">
        <h3>Commercial / Revenue</h3>
        <p>Invoice value (AED) data is not available in the current dataset.<br />
          This page is conditional on billing/value data being accessible (per the project spec).</p>
      </div>
    );
  }
  const byTier = sortDesc(groupCount(rows, "integration_tier", (r) => r.processed_value_aed || 0));
  const byGroup = sortDesc(groupCount(rows, "group_account_name", (r) => r.processed_value_aed || 0));
  const valTrend = monthlyTrend(rows);
  return (
    <>
      <div className="kpis">
        <Kpi label="Total Processed Value" value={fmtAed(k.processedValue)} />
        <Kpi label="Avg Value per Processed Invoice"
          value={fmtAed(k.processed ? k.processedValue / k.processed : 0)} />
      </div>
      <div className="grid-2">
        <Card title="Processed Value by Integration Tier (AED)"><VBar data={byTier} /></Card>
        <Card title="Processed Value by Client Group (AED)"
          hint="Uses the parent/group rollup so multi-entity groups aggregate across their tenants.">
          <HBar data={byGroup} money />
        </Card>
        <Card title="Processed Value Trend (AED)">
          <Trend data={valTrend} keys={[{ key: "value", label: "Processed value (AED)" }]} />
        </Card>
      </div>
    </>
  );
}
