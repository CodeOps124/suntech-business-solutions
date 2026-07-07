// Build the frontend data bundle from the generated sample CSVs.
// Output: src/data/dataset.json — a denormalized invoice list + the dimension
// lookups + the RLS grant table. The app does all aggregation client-side so it
// can run with no backend, while staying tenant-scoped (the same RLS keys the
// real QuickSight dataset uses are present on every row).
//
// In production this JSON is replaced by either (a) the QuickSight embed, or
// (b) a real REST endpoint over reporting.v_invoice_detail. The shape matches
// v_invoice_detail so the swap is mechanical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../data");
const OUT = path.resolve(__dirname, "../src/data/dataset.json");

function readCsv(file) {
  const text = fs.readFileSync(path.join(DATA, file), "utf8").trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((line) => {
    // simple CSV: our generator never quotes fields with commas
    const cells = line.split(",");
    const row = {};
    cols.forEach((c, i) => (row[c] = cells[i] === "" ? null : cells[i]));
    return row;
  });
}

const num = (v) => (v == null ? null : Number(v));
const bool = (v) => v === "True" || v === "true" || v === "1";

const dimDate = Object.fromEntries(readCsv("dim_date.csv").map((r) => [r.date_key, r]));
const dimTenant = Object.fromEntries(readCsv("dim_tenant.csv").map((r) => [r.tenant_key, r]));
const dimBuyer = Object.fromEntries(readCsv("dim_buyer.csv").map((r) => [r.buyer_key, r]));
const dimChannel = Object.fromEntries(readCsv("dim_channel.csv").map((r) => [r.channel_key, r]));
const fact = readCsv("fact_invoice.csv");
const grants = readCsv("rls_user_grant.csv");

// Denormalize to the v_invoice_detail shape.
const invoices = fact.map((f) => {
  const t = dimTenant[f.tenant_key] || {};
  const b = dimBuyer[f.buyer_key] || {};
  const c = dimChannel[f.channel_key] || {};
  const d = dimDate[f.submitted_date_key] || {};
  const processed = f.status === "fta_acknowledged";
  return {
    client_invoice_id: f.client_invoice_id,
    tenant_id: t.tenant_id,
    tenant_name: t.tenant_name,
    group_account_id: t.group_account_id,
    group_account_name: t.group_account_name,
    integration_tier: t.integration_tier,
    trn: t.trn,
    buyer_id: b.buyer_id || null,
    buyer_name: b.buyer_name || "Unknown buyer",
    buyer_country: b.buyer_country || null,
    is_peppol_registered: bool(b.is_peppol_registered),
    channel_code: c.channel_code,
    channel_name: c.channel_name,
    direction: f.direction,
    status: f.status,
    is_processed: processed ? 1 : 0,
    is_failed: f.status === "validation_failed" || f.status === "rejected" ? 1 : 0,
    is_transmitted: f.status === "transmitted" || processed ? 1 : 0,
    value_aed: num(f.value_aed),
    currency: f.currency,
    processed_value_aed: processed ? num(f.value_aed) : null,
    submitted_at: f.submitted_at,
    acknowledged_at: f.acknowledged_at || null,
    ttack_minutes: num(f.ttack_minutes),
    error_code: f.error_code || null,
    submitted_date: d.full_date,
    submitted_year_month: d.year_month,
  };
});

// Build the RLS map: principal -> [tenant_id...]. Group grants fan out.
const tenantsByGroup = {};
Object.values(dimTenant).forEach((t) => {
  (tenantsByGroup[t.group_account_id] ||= []).push(t.tenant_id);
});
const rls = {};
for (const g of grants) {
  const arr = (rls[g.quicksight_principal] ||= []);
  if (g.tenant_id) arr.push(g.tenant_id);
  else if (g.group_account_id) arr.push(...(tenantsByGroup[g.group_account_id] || []));
}

const tenants = Object.values(dimTenant).map((t) => ({
  tenant_id: t.tenant_id,
  tenant_name: t.tenant_name,
  group_account_id: t.group_account_id,
  group_account_name: t.group_account_name,
  integration_tier: t.integration_tier,
  trn: t.trn,
}));

const bundle = {
  generated_at: new Date().toISOString(),
  invoice_count: invoices.length,
  tenants,
  rls,
  invoices,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(bundle));
console.log(
  `build-data: wrote ${invoices.length} invoices, ${tenants.length} tenants, ` +
    `${Object.keys(rls).length} RLS principals -> ${path.relative(process.cwd(), OUT)}`
);
