import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.jsx";
import { useInvoiceStore } from "./data/InvoiceStore.jsx";
import Analytics from "./pages/Analytics.jsx";
import Invoices from "./pages/Invoices.jsx";
import InvoiceDetail from "./pages/InvoiceDetail.jsx";
import Tenants from "./pages/Tenants.jsx";
import MasterData from "./pages/MasterData.jsx";
import Processing from "./pages/Processing.jsx";
import Ledger from "./pages/Ledger.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  { group: "Compliance" },
  { to: "/analytics", icon: "📊", label: "Analytics" },
  { to: "/processing", icon: "⚙️", label: "Processing (auto)" },
  { to: "/invoices", icon: "🧾", label: "Invoices (AR/AP)" },
  { to: "/tenants", icon: "🏢", label: "Legal Entities" },
  { group: "ERP Modules" },
  { to: "/master-data", icon: "🗂️", label: "Master Data" },
  { to: "/receivables", icon: "💰", label: "Receivables (AR)" },
  { to: "/payables", icon: "📥", label: "Payables (AP)" },
  { to: "/settings", icon: "⚙️", label: "Settings" },
];

const TITLES = {
  "/analytics": "Analytics — P&L Invoice Insights",
  "/processing": "Processing — automated TCA pipeline",
  "/invoices": "Invoices",
  "/tenants": "Legal Entities",
  "/master-data": "Master Data",
  "/receivables": "Receivables (AR)",
  "/payables": "Payables (AP)",
  "/settings": "Settings",
};

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">TCA</div>
        <div className="name">
          Suntech TCA
          <small>Tax Compliance Agent</small>
        </div>
      </div>
      {NAV.map((n, i) =>
        n.group ? (
          <div className="nav-group" key={"g" + i}>{n.group}</div>
        ) : (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="ico">{n.icon}</span>
            {n.label}
          </NavLink>
        )
      )}
      <div className="nav-spacer" />
      <div style={{ fontSize: 11, opacity: 0.6, padding: "8px 10px" }}>
        UAE Peppol · FTA-accredited ASP<br />Data residency: AWS me-central-1
      </div>
    </aside>
  );
}

function PersonaPicker() {
  const { personas, principalId, setPrincipalId, persona } = useAuth();
  const badge =
    persona.role === "internal-admin" ? "admin" : persona.role === "client" ? "client" : "internal";
  return (
    <div className="persona-pick">
      <span className={`badge ${badge}`}>
        {persona.role === "internal-admin" ? "ADMIN" : persona.role === "client" ? "CLIENT" : "INTERNAL"}
      </span>
      <label>Signed in as</label>
      <select value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}

function DataSourceBadge() {
  const { source, loading } = useInvoiceStore();
  if (loading) return <span className="badge internal">syncing…</span>;
  if (source === "api") return <span className="badge internal" title="Live data from the Django API">● Django API</span>;
  return <span className="badge admin" title="Django API not reachable — using bundled sample data">● local data</span>;
}

function Topbar() {
  const { pathname } = useLocation();
  const title =
    TITLES[pathname] || (pathname.startsWith("/invoices/") ? "Invoice Detail" : "Suntech TCA");
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="spacer" />
      <DataSourceBadge />
      <PersonaPicker />
    </header>
  );
}

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/analytics" replace />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/processing" element={<Processing />} />
            {/* /approvals kept as a redirect: TCA is automated, no manual queue. */}
            <Route path="/approvals" element={<Navigate to="/processing" replace />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/master-data" element={<MasterData />} />
            <Route
              path="/receivables"
              element={<Ledger direction="AR" title="Receivables" counterpartyLabel="Customer" />}
            />
            <Route
              path="/payables"
              element={<Ledger direction="AP" title="Payables" counterpartyLabel="Supplier / buyer" />}
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/analytics" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
