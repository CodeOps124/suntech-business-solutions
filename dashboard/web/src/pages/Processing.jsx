import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useScopedInvoices } from "../data/useInvoices.js";
import { pipelineSummary, STAGES } from "../data/pipeline.js";
import { Card, HBar, StatusPill, fmt } from "../components/ui.jsx";

/**
 * Automated processing monitor — the TCA pipeline runs itself. No manual
 * approve/reject. Invoices flow Client → TCA → validate → Peppol → FTA ack,
 * with the Gap Analyzer + retry logic auto-remediating fixable failures.
 * Only truly-stuck invoices surface as exceptions.
 */
export default function Processing() {
  const { allowedTenants } = useAuth();
  const [tenantId, setTenantId] = useState("");
  const rows = useScopedInvoices({ tenantId });
  const summary = useMemo(() => pipelineSummary(rows), [rows]);

  // Animation: when replaying, we reveal the funnel/counters progressively.
  const [progress, setProgress] = useState(1); // 0..1, 1 = fully computed
  const [playing, setPlaying] = useState(false);
  const raf = useRef(null);

  const replay = () => {
    cancelAnimationFrame(raf.current);
    setProgress(0);
    setPlaying(true);
    const start = performance.now();
    const dur = 2200;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // Reset to fully-computed whenever the scope changes.
  useEffect(() => { setProgress(1); setPlaying(false); }, [tenantId, rows.length]);

  const scale = (n) => Math.round(n * progress);

  return (
    <>
      <div className="filters">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">All my tenants</option>
          {allowedTenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>)}
        </select>
        <button onClick={replay} disabled={playing}>{playing ? "Running…" : "▶ Replay automated run"}</button>
        <div className="grow" />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {fmt(rows.length)} invoices · fully automated — no manual approval
        </span>
      </div>

      <div className="kpis">
        <Kpi label="Automation rate" value={`${summary.automationRate.toFixed(1)}%`}
          sub="handled with zero human touch" good />
        <Kpi label="Straight-through" value={fmt(scale(summary.straightThrough))}
          sub={`${summary.stpRate.toFixed(1)}% acked, no remediation`} />
        <Kpi label="Auto-remediated" value={fmt(scale(summary.autoRemediated))}
          sub="Gap Analyzer + auto-retry" />
        <Kpi label="Exceptions" value={fmt(scale(summary.exceptions))}
          sub="need a source-side fix" bad={summary.exceptions > 0} />
      </div>

      {/* 5-corner flow visual */}
      <Card title="5-corner pipeline — invoices auto-flow through each stage"
        hint="Client → TCA → validate → Peppol (AS4) → FTA acknowledgement. Counts are cumulative reach; drop-off between stages is auto-remediated or surfaced as an exception.">
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
          {STAGES.map((s, i) => {
            const val = scale(summary.funnel[i].value);
            const prev = i === 0 ? val : scale(summary.funnel[i - 1].value);
            const dropoff = prev - val;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "stretch", gap: 8, flex: "1 1 200px" }}>
                <div style={{
                  flex: 1, border: "1px solid var(--line)", borderRadius: 10, padding: 14,
                  background: i === STAGES.length - 1 ? "#dff4ea" : "#fafbff",
                }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.corner}</div>
                  <div style={{ fontWeight: 700 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--brand)" }}>{fmt(val)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.desc}</div>
                  {dropoff > 0 && (
                    <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>
                      −{fmt(dropoff)} auto-handled here
                    </div>
                  )}
                </div>
                {i < STAGES.length - 1 && (
                  <div style={{ alignSelf: "center", color: "var(--brand)", fontSize: 22 }}>→</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Auto-remediation by cause"
          hint="Failures the platform fixed automatically — Gap Analyzer auto-fill from master data, or retry/DLQ for transient errors.">
          <HBar data={summary.remediationByType.map((r) => ({ ...r, value: scale(r.value) }))} color="#15a06b" />
        </Card>
        <Card title="What automation did"
          hint="No invoice in this view required a human decision.">
          <table>
            <tbody>
              <Row k="Submitted to TCA" v={fmt(scale(summary.total))} />
              <Row k="Acknowledged (final)" v={fmt(scale(summary.acknowledged))} />
              <Row k="Still in flight" v={fmt(scale(summary.inFlight))} />
              <Row k="Auto-remediated" v={fmt(scale(summary.autoRemediated))} />
              <Row k="Exceptions (source fix)" v={fmt(scale(summary.exceptions))} />
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Exceptions — auto-flagged, ${fmt(summary.exceptions)} need a source-side fix`}
        hint="The platform could NOT auto-resolve these (e.g. buyer not on Peppol, or a data conflict). They are surfaced — not queued for manual approval. Resolution is fixing the source data / buyer onboarding, not clicking a button.">
        <div style={{ marginTop: -4 }}>
          <table>
            <thead>
              <tr><th>Invoice</th><th>Tenant</th><th>Buyer</th><th>Auto-flag reason</th><th>Status</th></tr>
            </thead>
            <tbody>
              {summary.exceptionList.slice(0, 50).map((r) => (
                <tr key={r.tenant_id + r.client_invoice_id}>
                  <td className="mono"><Link to={`/invoices/${encodeURIComponent(r.client_invoice_id)}`}>{r.client_invoice_id}</Link></td>
                  <td>{r.tenant_name}</td>
                  <td>{r.buyer_name}</td>
                  <td><span className="pill bad">{r._reason}</span></td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
              {!summary.exceptionList.length && (
                <tr><td colSpan={5} className="empty">No exceptions in scope — everything auto-cleared. 🎉</td></tr>
              )}
            </tbody>
          </table>
          {summary.exceptions > 50 && <div className="hint" style={{ marginTop: 8 }}>Showing first 50 of {fmt(summary.exceptions)}.</div>}
        </div>
      </Card>
    </>
  );
}

function Kpi({ label, value, sub, good, bad }) {
  const color = good ? "var(--good)" : bad ? "var(--bad)" : undefined;
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
function Row({ k, v }) {
  return <tr><td style={{ color: "var(--muted)", width: 200 }}>{k}</td><td style={{ fontWeight: 600 }}>{v}</td></tr>;
}
