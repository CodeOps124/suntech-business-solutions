import { createContext, useContext, useEffect, useState } from "react";
import dataset from "./dataset.json";
import { useAuth } from "../auth/AuthContext.jsx";
import { fetchAllInvoices, apiReachable } from "./api.js";

/**
 * Central invoice store. Hydrates from the Django API when reachable (data is
 * RLS-scoped server-side), otherwise falls back to the bundled dataset.json
 * (scoped client-side). Either way it exposes a plain array of invoice rows in
 * the same shape, so the existing hooks/pages don't change.
 */
const StoreContext = createContext(null);

export function InvoiceStoreProvider({ children }) {
  const { principalId, allowedTenantIds } = useAuth();
  const [state, setState] = useState({ rows: [], source: "loading", loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const online = await apiReachable();
      if (cancelled) return;

      if (online) {
        try {
          const rows = await fetchAllInvoices(principalId);
          if (!cancelled) setState({ rows, source: "api", loading: false });
          return;
        } catch {
          /* fall through to local */
        }
      }
      // Local fallback: scope client-side by the principal's allowed tenants.
      const allow = new Set(allowedTenantIds);
      const rows = dataset.invoices.filter((r) => allow.has(r.tenant_id));
      if (!cancelled) setState({ rows, source: "local", loading: false });
    })();
    return () => { cancelled = true; };
  }, [principalId, allowedTenantIds]);

  return <StoreContext.Provider value={state}>{children}</StoreContext.Provider>;
}

export function useInvoiceStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useInvoiceStore must be used within InvoiceStoreProvider");
  return ctx;
}
