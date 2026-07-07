/**
 * TCA automated processing pipeline (5-corner model) — computed over the data.
 *
 * The live TCA platform processes invoices automatically: Client → TCA →
 * (validate → Peppol transmit → FTA acknowledge), with acks at each hop. There
 * is NO manual approval — this module models that automation so the dashboard
 * can show invoices flowing through the corners and being auto-remediated.
 *
 * This is a read/aggregate view of platform behaviour (the project never sorts
 * invoices itself); the "remediation" here reflects what the Gap Analyzer +
 * retry logic do automatically, projected onto the procedural data.
 */

// The pipeline corners, in order. Each invoice's stored status tells us how far
// it got; we map that onto these stages.
export const STAGES = [
  { key: "submitted", label: "Submitted", corner: "C1→C2", desc: "Received by TCA" },
  { key: "validated", label: "Validated", corner: "C2", desc: "PINT-AE + FTA rules" },
  { key: "transmitted", label: "Transmitted", corner: "C2→C3→C4", desc: "Peppol AS4 to buyer" },
  { key: "acknowledged", label: "FTA-acknowledged", corner: "C5", desc: "Tax Data Document ack" },
];

// How far each stored status reaches in the pipeline (stage index, 0-based).
// validation_failed stops at "submitted" (failed before validation passed);
// rejected stops at "validated" (passed validation, failed at transmit/FTA).
const STATUS_REACH = {
  submitted: 0,
  validation_failed: 0,
  transmitted: 2,
  fta_acknowledged: 3,
  rejected: 1,
};

// Which validation error codes the Gap Analyzer can auto-fix from master data
// (missing/derivable fields). TRN / tax-category / mandatory-field gaps are
// auto-fillable; a currency mismatch is a data conflict needing the source fix.
const AUTO_FIXABLE = new Set([
  "E-PINT-MANDATORY",
  "E-TRN-INVALID",
  "E-TAXCAT-MISSING",
]);

// Rejections that are NOT a Suntech/client fault and can't be auto-remediated
// (the buyer simply isn't on the Peppol network yet) — a market-readiness gap.
const NON_REMEDIABLE_REJECT = new Set(["R-BUYER-NOT-REGISTERED"]);

/**
 * Classify one invoice's automated outcome.
 * Returns: { reached, terminal, autoRemediated, exception, exceptionReason }
 */
export function classify(inv) {
  const reached = STATUS_REACH[inv.status] ?? 0;

  if (inv.status === "fta_acknowledged") {
    return { reached: 3, terminal: "acknowledged", autoRemediated: false, exception: false };
  }
  if (inv.status === "transmitted") {
    // In flight — will be acknowledged automatically; not an exception.
    return { reached: 2, terminal: "in_flight", autoRemediated: false, exception: false };
  }
  if (inv.status === "submitted") {
    return { reached: 0, terminal: "in_flight", autoRemediated: false, exception: false };
  }
  if (inv.status === "validation_failed") {
    if (AUTO_FIXABLE.has(inv.error_code)) {
      // Gap Analyzer auto-fills + auto-resubmits → becomes acknowledged.
      return { reached: 3, terminal: "acknowledged", autoRemediated: true, exception: false };
    }
    // e.g. currency mismatch — needs a source-data correction.
    return {
      reached: 0, terminal: "exception", autoRemediated: false, exception: true,
      exceptionReason: inv.error_code || "Validation error (source fix required)",
    };
  }
  if (inv.status === "rejected") {
    if (NON_REMEDIABLE_REJECT.has(inv.error_code)) {
      return {
        reached: 1, terminal: "exception", autoRemediated: false, exception: true,
        exceptionReason: "Buyer not on Peppol (market-readiness gap)",
      };
    }
    // Other rejects (duplicate / schema / routing) — auto-retried by the
    // platform; assume eventual success via the retry/DLQ mechanism.
    return { reached: 3, terminal: "acknowledged", autoRemediated: true, exception: false };
  }
  return { reached, terminal: "in_flight", autoRemediated: false, exception: false };
}

/** Aggregate the whole scope into pipeline metrics. */
export function pipelineSummary(rows) {
  let funnel = [0, 0, 0, 0]; // count that reached each stage (cumulative)
  let acknowledged = 0,
    inFlight = 0,
    autoRemediated = 0,
    exceptions = 0;
  const exceptionList = [];
  const remediationByType = new Map();

  for (const inv of rows) {
    const c = classify(inv);
    for (let s = 0; s <= c.reached; s++) funnel[s] += 1;
    if (c.terminal === "acknowledged") acknowledged += 1;
    if (c.terminal === "in_flight") inFlight += 1;
    if (c.autoRemediated) {
      autoRemediated += 1;
      const key = inv.error_code || "auto-retry";
      remediationByType.set(key, (remediationByType.get(key) || 0) + 1);
    }
    if (c.exception) {
      exceptions += 1;
      if (exceptionList.length < 200) exceptionList.push({ ...inv, _reason: c.exceptionReason });
    }
  }

  const total = rows.length;
  const straightThrough = acknowledged - autoRemediated; // acked without remediation
  return {
    total,
    funnel: STAGES.map((s, i) => ({ name: s.label, value: funnel[i] })),
    acknowledged,
    inFlight,
    autoRemediated,
    exceptions,
    straightThrough,
    // Automation rate = share handled with zero human touch (acked + in-flight).
    automationRate: total ? ((acknowledged + inFlight) / total) * 100 : 0,
    stpRate: total ? (straightThrough / total) * 100 : 0,
    exceptionList,
    remediationByType: [...remediationByType.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  };
}
