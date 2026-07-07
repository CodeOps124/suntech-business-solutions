#!/usr/bin/env python3
"""
Local "boot up" preview of the Suntech P&L Invoice Analytics dashboard.

There is no local server to start — the real dashboard is Amazon QuickSight (a
cloud BI service). This harness is the closest faithful preview that runs with
zero installs: it loads the star schema + views into in-memory SQLite, loads the
generated CSVs, and runs the SAME aggregations each QuickSight page computes,
then prints them as a text dashboard. It also simulates dataset-layer RLS to
prove cross-tenant isolation.

Run:
    python scripts/preview_dashboard.py
    python scripts/preview_dashboard.py --as pnl-lead-pwc@suntech-global.com
    python scripts/preview_dashboard.py --tenant "PwC Middle East"
"""
from __future__ import annotations
import argparse, csv, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

# Windows consoles often default to cp1252 and choke on box-drawing chars.
# Force UTF-8 if we can; otherwise fall back to ASCII glyphs.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    BARC, RULE = "█", "─"
except Exception:
    BARC, RULE = "#", "-"

DIMS = ["dim_date", "dim_tenant", "dim_buyer", "dim_channel"]


def load_db() -> sqlite3.Connection:
    """In-memory SQLite mirroring reporting.* (SQLite-flavored, no server)."""
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row

    def load_csv(table, path):
        rows = list(csv.DictReader(open(path, encoding="utf-8")))
        cols = rows[0].keys()
        db.execute(f"CREATE TABLE {table} ({', '.join(cols)})")
        db.executemany(
            f"INSERT INTO {table} VALUES ({', '.join('?' for _ in cols)})",
            [[(c if c != '' else None) for c in r.values()] for r in rows],
        )
        return len(rows)

    for d in DIMS:
        load_csv(d, os.path.join(DATA, f"{d}.csv"))
    n_fact = load_csv("fact_invoice", os.path.join(DATA, "fact_invoice.csv"))
    load_csv("rls_user_grant", os.path.join(DATA, "rls_user_grant.csv"))

    # v_invoice_detail — the wide row QuickSight ingests (mirrors 02_*.sql).
    db.executescript("""
    CREATE VIEW v_invoice_detail AS
    SELECT
        f.invoice_key, f.client_invoice_id,
        t.tenant_id, t.tenant_name, t.group_account_id, t.group_account_name,
        t.integration_tier, t.trn,
        b.buyer_id, COALESCE(b.buyer_name,'Unknown buyer') AS buyer_name,
        b.buyer_country, b.is_peppol_registered,
        c.channel_code, c.channel_name,
        f.direction, f.status,
        CASE WHEN f.status='fta_acknowledged' THEN 1 ELSE 0 END AS is_processed,
        1 AS is_submitted,
        CASE WHEN f.status IN ('transmitted','fta_acknowledged') THEN 1 ELSE 0 END AS is_transmitted,
        CASE WHEN f.status IN ('validation_failed','rejected') THEN 1 ELSE 0 END AS is_failed,
        f.value_aed, f.currency,
        CASE WHEN f.status='fta_acknowledged' THEN f.value_aed ELSE NULL END AS processed_value_aed,
        f.submitted_at, f.acknowledged_at, f.ttack_minutes, f.error_code,
        d.full_date AS submitted_date, d.year_month AS submitted_year_month
    FROM fact_invoice f
    JOIN dim_tenant  t ON t.tenant_key  = f.tenant_key
    JOIN dim_channel c ON c.channel_key = f.channel_key
    JOIN dim_date    d ON d.date_key    = f.submitted_date_key
    LEFT JOIN dim_buyer b ON b.buyer_key = f.buyer_key;

    -- v_rls_rules — group grants fanned out to member tenants (mirrors 02_*.sql).
    CREATE VIEW v_rls_rules AS
    SELECT g.quicksight_principal AS UserName, g.tenant_id
      FROM rls_user_grant g
     WHERE g.tenant_id IS NOT NULL
    UNION
    SELECT g.quicksight_principal AS UserName, t.tenant_id
      FROM rls_user_grant g
      JOIN dim_tenant t ON t.group_account_id = g.group_account_id
     WHERE g.group_account_id IS NOT NULL;
    """)
    return db, n_fact


def rls_clause(db, principal):
    """Return (sql_predicate, params) enforcing dataset-layer RLS for a user.

    Mirrors QuickSight GRANT_ACCESS semantics: a user sees only tenant_ids
    granted to them; a user with no grants sees nothing.
    """
    if not principal:
        return "1=1", []          # admin/full preview (no RLS)
    ids = [r["tenant_id"] for r in
           db.execute("SELECT tenant_id FROM v_rls_rules WHERE UserName=?", [principal])]
    if not ids:
        return "1=0", []          # absent principal -> no rows
    return f"tenant_id IN ({','.join('?' for _ in ids)})", ids


def q1(db, sql, params=()):
    row = db.execute(sql, params).fetchone()
    return row[0] if row and row[0] is not None else 0


def bar(label, value, maxv, width=34):
    n = 0 if maxv == 0 else int(round(value / maxv * width))
    return f"  {label:<28} {BARC*n} {value:,}"


def section(title):
    print("\n" + RULE * 64)
    print(f"  {title}")
    print(RULE * 64)


def run(db, principal, tenant_filter):
    where, params = rls_clause(db, principal)
    base = f"FROM v_invoice_detail WHERE {where}"

    scope = "ALL TENANTS (admin preview)" if not principal else principal
    print("=" * 64)
    print("  SUNTECH — P&L INVOICE ANALYTICS  (local preview of QuickSight)")
    print(f"  Viewing as: {scope}")
    if tenant_filter:
        print(f"  Tenant filter: {tenant_filter}")
    print("=" * 64)

    # ---- EXECUTIVE OVERVIEW -------------------------------------------------
    section("EXECUTIVE OVERVIEW — KPI cards")
    total      = q1(db, f"SELECT COUNT(*) {base}", params)
    processed  = q1(db, f"SELECT SUM(is_processed) {base}", params)
    pvalue     = q1(db, f"SELECT SUM(processed_value_aed) {base}", params)
    ttack      = q1(db, f"SELECT AVG(ttack_minutes) {base}", params)
    failed     = q1(db, f"SELECT SUM(is_failed) {base}", params)
    rej_rate   = (failed / total * 100) if total else 0
    print(f"  Invoices Processed (FTA-ack) : {processed:,}")
    print(f"  Processed Value (AED)        : {pvalue:,.0f}")
    print(f"  Avg Time-to-Acknowledge      : {ttack:,.0f} min")
    print(f"  Rejection Rate               : {rej_rate:.1f}%")
    print(f"  (Total invoices in scope     : {total:,})")

    section("Processed by Integration Tier")
    rows = db.execute(f"SELECT integration_tier, SUM(is_processed) v {base} "
                      f"GROUP BY integration_tier ORDER BY v DESC", params).fetchall()
    mx = max([r["v"] for r in rows], default=0)
    for r in rows: print(bar(r["integration_tier"], r["v"], mx))

    section("Status Breakdown")
    rows = db.execute(f"SELECT status, COUNT(*) v {base} GROUP BY status ORDER BY v DESC", params).fetchall()
    mx = max([r["v"] for r in rows], default=0)
    for r in rows: print(bar(r["status"], r["v"], mx))

    section("Top Tenants by Processed Volume")
    rows = db.execute(f"SELECT tenant_name, SUM(is_processed) v {base} "
                      f"GROUP BY tenant_name ORDER BY v DESC LIMIT 10", params).fetchall()
    mx = max([r["v"] for r in rows], default=0)
    for r in rows: print(bar(r["tenant_name"], r["v"], mx))

    # ---- TENANT EXPLORER ----------------------------------------------------
    if tenant_filter:
        tparams = params + [tenant_filter]
        tbase = f"{base} AND tenant_name = ?"
        section(f"TENANT EXPLORER — {tenant_filter}")
        tproc = q1(db, f"SELECT SUM(is_processed) {tbase}", tparams)
        print(f"  Processed for this tenant: {tproc:,}")
        print("\n  Processed Invoices by Buyer (this tenant's customers):")
        rows = db.execute(f"SELECT buyer_name, SUM(is_processed) v {tbase} "
                          f"GROUP BY buyer_name ORDER BY v DESC", tparams).fetchall()
        mx = max([r["v"] for r in rows], default=0)
        for r in rows: print(bar(r["buyer_name"], r["v"], mx))
        print("\n  AR / AP split:")
        for r in db.execute(f"SELECT direction, COUNT(*) v {tbase} GROUP BY direction", tparams):
            print(f"    {r['direction']}: {r['v']:,}")

    # ---- OPERATIONAL HEALTH -------------------------------------------------
    section("OPERATIONAL HEALTH — Error Code Breakdown")
    rows = db.execute(f"SELECT error_code, COUNT(*) v {base} AND error_code IS NOT NULL "
                      f"GROUP BY error_code ORDER BY v DESC", params).fetchall()
    mx = max([r["v"] for r in rows], default=0)
    for r in rows: print(bar(r["error_code"], r["v"], mx))

    section("Failures: Buyer on Peppol vs NOT on Peppol (interop gap)")
    rows = db.execute(
        f"SELECT CASE WHEN is_peppol_registered IN ('True','1',1) THEN 'Buyer on Peppol' "
        f"ELSE 'Buyer NOT on Peppol' END g, SUM(is_failed) v {base} "
        f"GROUP BY g ORDER BY v DESC", params).fetchall()
    mx = max([r["v"] for r in rows], default=0)
    for r in rows: print(bar(r["g"], r["v"], mx))

    # ---- COMMERCIAL ---------------------------------------------------------
    section("COMMERCIAL — Processed Value by Client Group (AED)")
    rows = db.execute(f"SELECT group_account_name, SUM(processed_value_aed) v {base} "
                      f"GROUP BY group_account_name ORDER BY v DESC", params).fetchall()
    mx = max([(r["v"] or 0) for r in rows], default=0)
    for r in rows:
        v = r["v"] or 0
        n = 0 if mx == 0 else int(round(v / mx * 34))
        print(f"  {r['group_account_name']:<28} {BARC*n} {v:,.0f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as", dest="principal", default=None,
                    help="simulate RLS as this QuickSight principal (email)")
    ap.add_argument("--tenant", default=None, help="Tenant Explorer focus (tenant_name)")
    ap.add_argument("--rls-test", action="store_true",
                    help="run the cross-tenant isolation negative test and exit")
    args = ap.parse_args()

    if not os.path.exists(os.path.join(DATA, "fact_invoice.csv")):
        print("No sample data. Run: python etl/generate_sample_data.py", file=sys.stderr)
        sys.exit(1)

    db, n_fact = load_db()

    if args.rls_test:
        run_rls_test(db)
        return

    # default to PwC tenant focus when no tenant given, so the headline story shows
    tenant = args.tenant
    if tenant is None and args.principal in (None, "pnl-lead-pwc@suntech-global.com"):
        tenant = "PwC Middle East"
    run(db, args.principal, tenant)
    print("\n" + "=" * 64)
    print(f"  Loaded {n_fact:,} invoices into in-memory SQLite. Preview only —")
    print("  deploy the real dashboard with scripts/deploy_quicksight.sh")
    print("=" * 64)


def run_rls_test(db):
    """Prove dataset-layer RLS blocks cross-tenant reads."""
    print("RLS cross-tenant isolation test")
    print("-" * 50)
    cases = [
        ("pnl-lead-pwc@suntech-global.com",   "PwC: should see ONLY TEN-PWC-AE"),
        ("pnl-lead-falcon@suntech-global.com","Falcon: should see the 3 Falcon tenants"),
        ("nobody@suntech-global.com",         "Ungranted user: should see NOTHING"),
    ]
    ok = True
    for principal, desc in cases:
        where, params = rls_clause(db, principal)
        tenants = [r["tenant_id"] for r in db.execute(
            f"SELECT DISTINCT tenant_id FROM v_invoice_detail WHERE {where} ORDER BY tenant_id",
            params)]
        rows = q1(db, f"SELECT COUNT(*) FROM v_invoice_detail WHERE {where}", params)
        print(f"\n  {principal}\n    {desc}")
        print(f"    visible tenants: {tenants or '(none)'}")
        print(f"    visible rows   : {rows:,}")
        # assertions
        if principal.startswith("pnl-lead-pwc") and tenants != ["TEN-PWC-AE"]:
            ok = False; print("    !! FAIL: PwC user saw other tenants")
        if principal.startswith("nobody") and rows != 0:
            ok = False; print("    !! FAIL: ungranted user saw rows")
        if principal.startswith("pnl-lead-falcon") and len(tenants) != 3:
            ok = False; print("    !! FAIL: Falcon group grant did not fan out to 3 tenants")
    print("\n  RESULT:", "PASS — RLS isolates at the data layer" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
