#!/usr/bin/env python3
"""
Generate realistic sample data for the Suntech P&L Invoice Analytics dashboard.

Why this exists
---------------
The real dashboard reads from a READ-ONLY replica of TCA's data store
(PROJECT_OVERVIEW.md). For local development, demos, and reconciliation testing we need
representative data WITHOUT touching any production system. This script emits the
star-schema tables as CSVs that load straight into the reporting schema (or into
QuickSight SPICE directly via the v_invoice_detail shape).

It is dependency-free (stdlib only) and deterministic (fixed seed) so that
reconciliation totals are reproducible across runs.

It deliberately includes:
  * a "PwC" tenant, so the example user story
    ("...invoices processed for the customers of PwC") is directly answerable;
  * a multi-entity GROUP ("Falcon Group") with several tenants, to exercise the
    parent/group rollup + group-level RLS;
  * all four integration tiers;
  * a realistic status mix (most processed, some failed/rejected/in-flight);
  * some buyers that are NOT Peppol-registered (interop-gap backlog item).
"""

from __future__ import annotations
import csv
import os
import random
from datetime import datetime, timedelta, timezone

SEED = 20260618
random.seed(SEED)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(OUT_DIR, exist_ok=True)

# ---- Window: ~6 months of invoices ending at a fixed reference date (reproducible totals) ----
END_DATE = datetime(2026, 6, 18, tzinfo=timezone.utc)
START_DATE = END_DATE - timedelta(days=180)

# ---- Tenants (legal entities). group_account_id ties multi-entity groups. -----
# (tenant_id, tenant_name, trn, group_account_id, group_name, tier, weight)
TENANTS = [
    # PwC — the example story. Single-entity client on Connect (API).
    ("TEN-PWC-AE",  "PwC Middle East",         "100123456700003", "GRP-PWC",    "PwC",          "Connect",  3.0),

    # Falcon Group — a real multi-entity group across different tiers.
    ("TEN-FAL-HQ",  "Falcon Holding LLC",      "100222333400003", "GRP-FALCON", "Falcon Group", "Embedded", 4.0),
    ("TEN-FAL-LOG", "Falcon Logistics FZE",    "100222333500003", "GRP-FALCON", "Falcon Group", "Managed",  2.0),
    ("TEN-FAL-RET", "Falcon Retail DMCC",      "100222333600003", "GRP-FALCON", "Falcon Group", "Portal",   1.0),

    # Independent mid-market + SMB tenants.
    ("TEN-ORYX",    "Oryx Trading Co",         "100345678900003", "GRP-ORYX",   "Oryx Trading", "Managed",  2.5),
    ("TEN-DESERT",  "Desert Rose Hospitality", "100456789000003", "GRP-DESERT", "Desert Rose",  "Connect",  1.5),
    ("TEN-GULFTEK", "GulfTek Software FZ-LLC",  "100567890100003", "GRP-GULFTEK","GulfTek",      "Connect",  2.0),
    ("TEN-MARINA",  "Marina Foods Trading",    "100678901200003", "GRP-MARINA", "Marina Foods", "Portal",   0.8),
]

CHANNELS = [
    # channel_code, channel_name, tier
    ("EMBEDDED_ERP", "In-ERP Connector",   "Embedded"),
    ("MANAGED_SFTP", "Managed SFTP Pull",  "Managed"),
    ("MANAGED_DB",   "Managed Staging DB", "Managed"),
    ("MANAGED_S3",   "Managed S3 Pull",    "Managed"),
    ("CONNECT_API",  "Self-Serve API",     "Connect"),
    ("CONNECT_SFTP", "Hosted SFTP",        "Connect"),
    ("PORTAL_BULK",  "Portal Bulk Upload", "Portal"),
    ("PORTAL_MANUAL","Portal Manual Entry","Portal"),
]
TIER_CHANNELS = {}
for code, name, tier in CHANNELS:
    TIER_CHANNELS.setdefault(tier, []).append(code)

# ---- Buyers (Corner 4). Some not yet Peppol-registered. ----------------------
BUYERS = [
    ("BUY-EMIRATES",  "Emirates Group",          "AE", True),
    ("BUY-ADNOC",     "ADNOC Distribution",      "AE", True),
    ("BUY-MAJID",     "Majid Al Futtaim",        "AE", True),
    ("BUY-DEWA",      "DEWA",                    "AE", True),
    ("BUY-ETISALAT",  "e& (Etisalat)",           "AE", True),
    ("BUY-ARAMEX",    "Aramex",                  "AE", True),
    ("BUY-CHALHOUB",  "Chalhoub Group",          "AE", True),
    ("BUY-LULU",      "Lulu Group",              "AE", True),
    ("BUY-SMALLCO1",  "Nakheel Spares LLC",      "AE", False),   # not on network yet
    ("BUY-SMALLCO2",  "Al Wasl Supplies",        "AE", False),   # not on network yet
    ("BUY-SAUDI1",    "STC Group",               "SA", True),
    ("BUY-EU1",       "Siemens AG",              "DE", True),
]

STATUSES = ["submitted", "validation_failed", "transmitted",
            "fta_acknowledged", "rejected"]
# Realistic mix: most invoices complete, a tail fails or is in flight.
STATUS_WEIGHTS = [0.04, 0.05, 0.06, 0.80, 0.05]

ERROR_CODES = {
    "validation_failed": ["E-PINT-MANDATORY", "E-TRN-INVALID", "E-TAXCAT-MISSING",
                          "E-CURRENCY-MISMATCH"],
    "rejected":          ["R-FTA-DUPLICATE", "R-BUYER-NOT-REGISTERED",
                          "R-PEPPOL-ROUTING", "R-FTA-SCHEMA"],
}


def daterange_keys(start: datetime, end: datetime):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def write_csv(name, header, rows):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    print(f"  wrote {len(rows):>6} rows -> {os.path.relpath(path)}")
    return path


def build_dim_date():
    rows = []
    for d in daterange_keys(START_DATE, END_DATE):
        rows.append([
            int(d.strftime("%Y%m%d")),
            d.strftime("%Y-%m-%d"),
            d.day, d.month, d.strftime("%B"),
            (d.month - 1) // 3 + 1, d.year,
            d.strftime("%Y-%m"),
            d.weekday() >= 5,
        ])
    return rows


def build_dim_tenant():
    rows = []
    for i, (tid, name, trn, gid, gname, tier, _w) in enumerate(TENANTS, start=1):
        onboarded = (START_DATE - timedelta(days=random.randint(30, 400))).strftime("%Y-%m-%d")
        rows.append([i, tid, name, trn, gid, gname, tier, onboarded, True])
    return rows


def build_dim_buyer():
    rows = []
    for i, (bid, name, country, peppol) in enumerate(BUYERS, start=1):
        rows.append([i, bid, name, country, peppol])
    return rows


def build_dim_channel():
    rows = []
    for i, (code, name, tier) in enumerate(CHANNELS, start=1):
        rows.append([i, code, name, tier])
    return rows


def build_fact_invoice(tenant_rows, buyer_rows, channel_rows):
    tenant_by_id = {r[1]: r for r in tenant_rows}          # tenant_id -> row
    channel_key_by_code = {r[1]: r[0] for r in channel_rows}
    buyer_keys = [r[0] for r in buyer_rows]
    buyer_peppol = {r[0]: r[4] for r in buyer_rows}

    tenant_weights = {t[0]: t[6] for t in TENANTS}          # tenant_id -> weight
    tenant_ids = [t[0] for t in TENANTS]
    weights = [tenant_weights[t] for t in tenant_ids]

    rows = []
    seq = 0
    n_invoices = 9000
    for _ in range(n_invoices):
        seq += 1
        tid = random.choices(tenant_ids, weights=weights, k=1)[0]
        trow = tenant_by_id[tid]
        tenant_key = trow[0]
        tier = trow[6]

        channel_code = random.choice(TIER_CHANNELS[tier])
        channel_key = channel_key_by_code[channel_code]

        # ~80% AR (sales/outbound) vs 20% AP (purchase/inbound).
        direction = "AR" if random.random() < 0.80 else "AP"

        buyer_key = random.choice(buyer_keys)
        status = random.choices(STATUSES, weights=STATUS_WEIGHTS, k=1)[0]

        # If buyer not Peppol-registered, bias toward a routing rejection.
        if not buyer_peppol[buyer_key] and random.random() < 0.5:
            status = "rejected"

        submitted = START_DATE + timedelta(
            seconds=random.randint(0, int((END_DATE - START_DATE).total_seconds())))
        submitted_date_key = int(submitted.strftime("%Y%m%d"))

        transmitted_at = ack_at = None
        ttack = None
        if status in ("transmitted", "fta_acknowledged"):
            transmitted_at = submitted + timedelta(minutes=random.randint(1, 90))
        if status == "fta_acknowledged":
            ack_at = transmitted_at + timedelta(minutes=random.randint(1, 240))
            ttack = int((ack_at - submitted).total_seconds() // 60)

        # Value (AED). A small fraction left NULL to prove graceful degradation.
        if random.random() < 0.03:
            value = ""
            currency = ""
        else:
            value = round(random.lognormvariate(8.5, 1.0), 2)   # ~ hundreds–100k AED
            currency = "AED"

        error_code = ""
        if status in ERROR_CODES:
            error_code = random.choice(ERROR_CODES[status])
            if status == "rejected" and not buyer_peppol[buyer_key]:
                error_code = "R-BUYER-NOT-REGISTERED"

        client_invoice_id = f"{tid}-INV-{seq:06d}"

        rows.append([
            seq,                      # invoice_key
            client_invoice_id,
            tenant_key,
            buyer_key,
            channel_key,
            direction,
            status,
            value,
            currency,
            submitted.isoformat(),
            transmitted_at.isoformat() if transmitted_at else "",
            ack_at.isoformat() if ack_at else "",
            submitted_date_key,
            ttack if ttack is not None else "",
            error_code,
        ])
    return rows


def build_rls_grants():
    """Sample RLS grants showing both a group-level lead and a restricted user."""
    return [
        # grant_id, principal, type, tenant_id, group_account_id
        [1, "pnl-lead-all@suntech-global.com", "USER", "", ""],   # see note below
        [2, "pnl-lead-falcon@suntech-global.com", "USER", "", "GRP-FALCON"],
        [3, "pnl-lead-pwc@suntech-global.com",    "USER", "TEN-PWC-AE", ""],
    ]
    # NOTE: grant_id 1 has neither tenant nor group -> represents an ADMIN /
    # "see everything" principal. RLS handles this via the QuickSight rule:
    # a principal absent from the rules table (or matching no row) is configured
    # as full-access in the dataset RLS setting. We therefore DROP row 1 before
    # writing, so admins are governed by the "not in rules = full access" config.


def main():
    print("Generating Suntech P&L sample data (seed=%d)..." % SEED)

    dim_date    = build_dim_date()
    dim_tenant  = build_dim_tenant()
    dim_buyer   = build_dim_buyer()
    dim_channel = build_dim_channel()
    fact        = build_fact_invoice(dim_tenant, dim_buyer, dim_channel)

    write_csv("dim_date.csv",
              ["date_key","full_date","day_of_month","month_num","month_name",
               "quarter","year","year_month","is_weekend"], dim_date)
    write_csv("dim_tenant.csv",
              ["tenant_key","tenant_id","tenant_name","trn","group_account_id",
               "group_account_name","integration_tier","onboarded_date","is_active"],
              dim_tenant)
    write_csv("dim_buyer.csv",
              ["buyer_key","buyer_id","buyer_name","buyer_country",
               "is_peppol_registered"], dim_buyer)
    write_csv("dim_channel.csv",
              ["channel_key","channel_code","channel_name","integration_tier"],
              dim_channel)
    write_csv("fact_invoice.csv",
              ["invoice_key","client_invoice_id","tenant_key","buyer_key",
               "channel_key","direction","status","value_aed","currency",
               "submitted_at","transmitted_at","acknowledged_at",
               "submitted_date_key","ttack_minutes","error_code"], fact)

    rls = [r for r in build_rls_grants() if r[3] or r[4]]   # drop the admin row
    write_csv("rls_user_grant.csv",
              ["grant_id","quicksight_principal","principal_type","tenant_id",
               "group_account_id"],
              [[r[0], r[1], "USER", r[3], r[4]] for r in rls])

    # Quick control totals so reconciliation has an expected answer.
    processed = sum(1 for r in fact if r[6] == "fta_acknowledged")
    pwc_key = next(t[0] for t in dim_tenant if t[1] == "TEN-PWC-AE")
    pwc_processed = sum(1 for r in fact if r[2] == pwc_key and r[6] == "fta_acknowledged")
    print("\nControl totals (use for Phase 5 reconciliation):")
    print(f"  total invoices        : {len(fact)}")
    print(f"  processed (FTA-ack)   : {processed}")
    print(f"  PwC processed (FTA-ack): {pwc_processed}")


if __name__ == "__main__":
    main()
