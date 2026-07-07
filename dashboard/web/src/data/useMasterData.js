import { useMemo } from "react";
import { useScopedInvoices } from "./useInvoices.js";

/**
 * Master data is derived from the scoped invoice stream so it stays tenant-safe
 * (a user only ever sees customers/suppliers tied to invoices they can see).
 *
 * In production this would read the real master-data tables that the Gap
 * Analyzer treats as the source of truth (TRN, registered address, trade
 * licence, item→tax-category mappings). Here we synthesize representative,
 * deterministic records from the buyers/tenants present in the data.
 */

// Deterministic item catalogue mapped to UAE tax categories.
const TAX_CATEGORIES = ["Standard-rated (5%)", "Zero-rated (0%)", "Exempt", "Out-of-scope"];
const ITEM_SEED = [
  ["Consulting services", "Standard-rated (5%)"],
  ["Software licence (annual)", "Standard-rated (5%)"],
  ["Cloud hosting", "Standard-rated (5%)"],
  ["Exported goods", "Zero-rated (0%)"],
  ["International freight", "Zero-rated (0%)"],
  ["Residential lease", "Exempt"],
  ["Local financial services", "Exempt"],
  ["Government fee passthrough", "Out-of-scope"],
  ["Hardware procurement", "Standard-rated (5%)"],
  ["Maintenance & support", "Standard-rated (5%)"],
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Customers = the buyers (Corner 4) that appear on this tenant scope's invoices. */
export function useCustomers(filters = {}) {
  const rows = useScopedInvoices(filters);
  return useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!r.buyer_id) continue;
      const c = m.get(r.buyer_id) || {
        buyer_id: r.buyer_id,
        buyer_name: r.buyer_name,
        buyer_country: r.buyer_country,
        is_peppol_registered: r.is_peppol_registered,
        invoices: 0,
        value: 0,
        tenants: new Set(),
      };
      c.invoices += 1;
      c.value += r.value_aed || 0;
      c.tenants.add(r.tenant_name);
      m.set(r.buyer_id, c);
    }
    return [...m.values()]
      .map((c) => ({ ...c, tenant_count: c.tenants.size }))
      .sort((a, b) => b.invoices - a.invoices);
  }, [rows]);
}

/** Items catalogue, deterministically tagged per item name. */
export function useItems() {
  return useMemo(
    () =>
      ITEM_SEED.map(([name, cat], i) => ({
        item_code: "ITM-" + String(1000 + i),
        name,
        tax_category: cat,
        unit: i % 3 === 0 ? "service" : "each",
      })),
    []
  );
}

export { TAX_CATEGORIES };

/** Suppliers (legal entities) in scope, with a synthesized master-data record. */
export function useScopedSuppliers() {
  const rows = useScopedInvoices();
  return useMemo(() => {
    const byTenant = new Map();
    for (const r of rows) {
      const s = byTenant.get(r.tenant_id) || {
        tenant_id: r.tenant_id,
        tenant_name: r.tenant_name,
        group_account_name: r.group_account_name,
        trn: r.trn,
        integration_tier: r.integration_tier,
        invoices: 0,
      };
      s.invoices += 1;
      byTenant.set(r.tenant_id, s);
    }
    return [...byTenant.values()].map((s) => {
      const h = hash(s.tenant_id);
      return {
        ...s,
        trade_licence: "TL-" + (100000 + (h % 900000)),
        address: `Office ${100 + (h % 800)}, ${
          ["Business Bay", "JLT", "DIFC", "Dubai Internet City", "DMCC"][h % 5]
        }, Dubai, UAE`,
        // Data-readiness: a synthetic completeness score for the Gap Analyzer view.
        master_data_completeness: 80 + (h % 21), // 80–100%
      };
    });
  }, [rows]);
}
