import { createContext, useContext, useMemo, useState } from "react";
import dataset from "../data/dataset.json";

/**
 * Auth + tenant-scoping context.
 *
 * This mirrors the QuickSight dataset-layer RLS in the UI so the frontend is
 * tenant-scoped from day one (supports both the internal P&L view and a
 * client-facing view). The `allowedTenantIds` here is the SAME concept as the
 * RLS rules dataset: which tenant_ids this principal may see.
 *
 * SECURITY NOTE: in production this is NOT the security boundary — the real
 * boundary is (a) QuickSight RLS on the embedded dashboard, and (b) the REST
 * API filtering server-side by the authenticated principal. This client-side
 * scoping is a UX convenience and defense-in-depth, never the sole control.
 * See docs/SECURITY_CHECKLIST.md.
 */

// Demo personas. In production these come from SSO / IAM Identity Center; the
// principal id is matched against the RLS grant table exactly as in QuickSight.
const PERSONAS = [
  {
    id: "admin@suntech-global.com",
    label: "Suntech P&L Lead — All Clients",
    role: "internal-admin",
    scope: "all", // sees every tenant (governed by explicit admin grant in prod)
  },
  {
    id: "pnl-lead-falcon@suntech-global.com",
    label: "P&L Lead — Falcon Group (group rollup)",
    role: "internal",
    scope: "rls",
  },
  {
    id: "pnl-lead-pwc@suntech-global.com",
    label: "Client User — PwC (tenant-scoped)",
    role: "client",
    scope: "rls",
  },
];

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [principalId, setPrincipalId] = useState(PERSONAS[0].id);

  const value = useMemo(() => {
    const persona = PERSONAS.find((p) => p.id === principalId) || PERSONAS[0];

    const allTenantIds = dataset.tenants.map((t) => t.tenant_id);
    const allowedTenantIds =
      persona.scope === "all"
        ? allTenantIds
        : dataset.rls[persona.id] || [];

    const allowedTenants = dataset.tenants.filter((t) =>
      allowedTenantIds.includes(t.tenant_id)
    );

    return {
      personas: PERSONAS,
      principalId,
      setPrincipalId,
      persona,
      isAdmin: persona.scope === "all",
      isClient: persona.role === "client",
      allowedTenantIds,
      allowedTenants,
    };
  }, [principalId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
