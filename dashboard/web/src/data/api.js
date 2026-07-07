/**
 * API client for the Django backend.
 *
 * The frontend prefers the live Django API; if it's unreachable (backend not
 * running) it falls back to the bundled dataset.json so the app still works.
 * The base URL comes from VITE_API_BASE (default http://localhost:8000/api).
 *
 * RLS: every request sends the current principal in the X-Principal header, so
 * the backend scopes results server-side — the same RLS the QuickSight dataset
 * enforces. The client never receives data outside its scope.
 */
export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

async function get(path, principal, params = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: { "X-Principal": principal || "" } });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
}

/** Page through /invoices to get every scoped row (used to hydrate the store). */
export async function fetchAllInvoices(principal) {
  let path = "/invoices/";
  let params = { page_size: 500 };
  const all = [];
  // follow DRF pagination `next` until exhausted
  let next = null;
  do {
    const data = next
      ? await fetch(next, { headers: { "X-Principal": principal || "" } }).then((r) => r.json())
      : await get(path, principal, params);
    all.push(...(data.results || []));
    next = data.next;
    params = {};
  } while (next);
  return all;
}

export const apiAnalyticsSummary = (principal, params) =>
  get("/analytics/summary", principal, params);
export const apiPipelineSummary = (principal, params) =>
  get("/pipeline/summary", principal, params);
export const apiTenants = (principal) => get("/tenants/", principal);
export const apiInvoiceDetail = (principal, id) =>
  get(`/invoices/${encodeURIComponent(id)}/`, principal);

/** Health probe: is the Django API reachable? */
export async function apiReachable() {
  try {
    const res = await fetch(API_BASE + "/tenants/", {
      headers: { "X-Principal": "admin@suntech-global.com" },
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
