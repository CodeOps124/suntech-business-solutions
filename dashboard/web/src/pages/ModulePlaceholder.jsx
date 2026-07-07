export default function ModulePlaceholder({ name, desc }) {
  return (
    <div className="placeholder">
      <h3>{name}</h3>
      <p>{desc}</p>
      <p style={{ fontSize: 12, marginTop: 16 }}>
        Roadmap ERP module — not built in this wave. The Analytics and Invoices
        modules are live; this shell is here so the navigation reflects the full
        intended product.
      </p>
    </div>
  );
}
