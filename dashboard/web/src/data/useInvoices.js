import { useMemo } from "react";
import { useInvoiceStore } from "./InvoiceStore.jsx";

/**
 * Returns the invoice rows the current principal is allowed to see, after
 * applying optional UI filters. The rows come from the InvoiceStore, which is
 * already RLS-scoped (server-side via the Django API, or client-side from the
 * bundled dataset.json fallback). All analytics + the invoice module read
 * through this so scoping is enforced in exactly one place.
 */
export function useScopedInvoices(filters = {}) {
  const { rows: scopedRows } = useInvoiceStore();
  const { tenantId, direction, status, search } = filters;

  return useMemo(() => {
    let rows = scopedRows;
    if (tenantId) rows = rows.filter((r) => r.tenant_id === tenantId);
    if (direction) rows = rows.filter((r) => r.direction === direction);
    if (status) rows = rows.filter((r) => r.status === status);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.client_invoice_id.toLowerCase().includes(q) ||
          (r.buyer_name || "").toLowerCase().includes(q) ||
          (r.tenant_name || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [scopedRows, tenantId, direction, status, search]);
}

// ---- aggregation helpers -------------------------------------------------- //

export function kpis(rows) {
  const total = rows.length;
  let processed = 0,
    failed = 0,
    processedValue = 0,
    ttackSum = 0,
    ttackN = 0,
    hasValue = false;
  for (const r of rows) {
    processed += r.is_processed;
    failed += r.is_failed;
    if (r.processed_value_aed != null) {
      processedValue += r.processed_value_aed;
    }
    if (r.value_aed != null) hasValue = true;
    if (r.ttack_minutes != null) {
      ttackSum += r.ttack_minutes;
      ttackN += 1;
    }
  }
  return {
    total,
    processed,
    failed,
    processedValue,
    hasValue,
    rejectionRate: total ? (failed / total) * 100 : 0,
    avgTtack: ttackN ? ttackSum / ttackN : 0,
  };
}

export function groupCount(rows, key, valueFn = () => 1) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] ?? "—";
    m.set(k, (m.get(k) || 0) + valueFn(r));
  }
  return [...m.entries()].map(([name, value]) => ({ name, value }));
}

export function sortDesc(arr, n) {
  // Sort by value desc; tie-break on name asc so equal values keep a stable,
  // predictable order across renders.
  const s = [...arr].sort(
    (a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name))
  );
  return n ? s.slice(0, n) : s;
}

/** Monthly trend of processed count + processed value. */
export function monthlyTrend(rows) {
  const m = new Map();
  for (const r of rows) {
    const ym = r.submitted_year_month || "—";
    const cur = m.get(ym) || { name: ym, processed: 0, failed: 0, value: 0 };
    cur.processed += r.is_processed;
    cur.failed += r.is_failed;
    cur.value += r.processed_value_aed || 0;
    m.set(ym, cur);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
