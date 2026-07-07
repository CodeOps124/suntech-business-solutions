#!/usr/bin/env python3
"""
ETL transform: TCA read-only replica  ->  reporting star schema.

This is the Step Functions "transform" stage (PROJECT_OVERVIEW.md "Architecture &
Automation"). It is written as plain Python so it can run as a Glue Python-shell
job, a Lambda, or a container task in the Step Functions state machine.

Hard security boundaries (PROJECT_OVERVIEW.md "Security & Compliance"):
  * SOURCE connection is READ-ONLY on the source replica.
  * TARGET connection is WRITE-ONLY on the reporting schema.
  * Both connection strings come from AWS Secrets Manager, never hard-coded.
  * The replica lives in a private subnet, no public endpoint.

This project READS the status already assigned by the live TCA Platform and
aggregates it. It does NOT re-derive / sort invoice status (PROJECT_OVERVIEW.md
"Conceptual Note").

Idempotency: the load is an UPSERT keyed on (tenant_id, client_invoice_id),
mirroring TCA's own idempotency contract (PROJECT_OVERVIEW.md C3). Re-running the ETL for
an overlapping window is a safe no-op for unchanged rows.

Usage:
    python etl_transform.py --since 2026-06-01            # incremental
    python etl_transform.py --full                        # full reload
    python etl_transform.py --from-csv ../data            # local dev (no DB)
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

# psycopg2 is imported lazily so the --from-csv dev path needs no DB driver.


# --------------------------------------------------------------------------- #
# Secrets / connections
# --------------------------------------------------------------------------- #
def _get_secret(secret_id: str) -> dict:
    """Fetch a JSON secret from AWS Secrets Manager."""
    import boto3
    sm = boto3.client("secretsmanager")
    val = sm.get_secret_value(SecretId=secret_id)["SecretString"]
    return json.loads(val)


def _connect(secret_id: str, *, readonly: bool):
    import psycopg2
    s = _get_secret(secret_id)
    conn = psycopg2.connect(
        host=s["host"], port=s.get("port", 5432),
        dbname=s["dbname"], user=s["username"], password=s["password"],
        sslmode="require",                       # TLS 1.2+ in transit (C8)
        connect_timeout=10,
    )
    conn.autocommit = False
    if readonly:
        # Defense in depth even though the DB role is itself read-only.
        with conn.cursor() as cur:
            cur.execute("SET default_transaction_read_only = on;")
    return conn


# --------------------------------------------------------------------------- #
# Transform — map raw source rows to the star-schema fact grain.
# --------------------------------------------------------------------------- #
# The source replica exposes a flat invoice event table. We compute the few
# derived columns the dashboard needs (date_key, ttack_minutes) here so the
# warehouse stays the single source of metric truth.

EXTRACT_SQL = """
    SELECT
        client_invoice_id,
        tenant_id,
        buyer_id,
        channel_code,
        direction,
        status,
        value_aed,
        currency,
        submitted_at,
        transmitted_at,
        acknowledged_at,
        error_code
    FROM source.invoice_events
    {where}
"""


def _date_key(ts: datetime) -> int:
    return int(ts.strftime("%Y%m%d"))


def _ttack_minutes(submitted, acknowledged):
    if not submitted or not acknowledged:
        return None
    return int((acknowledged - submitted).total_seconds() // 60)


def transform_row(r: dict) -> dict:
    """Pure function: one raw source row -> one fact-ready dict. Unit-testable."""
    submitted = r["submitted_at"]
    acknowledged = r.get("acknowledged_at")
    return {
        "client_invoice_id": r["client_invoice_id"],
        "tenant_id":  r["tenant_id"],
        "buyer_id":   r.get("buyer_id"),
        "channel_code": r["channel_code"],
        "direction":  r["direction"],
        "status":     r["status"],
        "value_aed":  r.get("value_aed"),
        "currency":   r.get("currency"),
        "submitted_at": submitted,
        "transmitted_at": r.get("transmitted_at"),
        "acknowledged_at": acknowledged,
        "submitted_date_key": _date_key(submitted),
        "ttack_minutes": _ttack_minutes(submitted, acknowledged),
        "error_code": r.get("error_code") or None,
  }

# --------------------------------------------------------------------------- #
# Load — UPSERT into fact_invoice resolving surrogate keys via the dims.
# --------------------------------------------------------------------------- #
UPSERT_SQL = """
INSERT INTO reporting.fact_invoice (
    client_invoice_id, tenant_key, buyer_key, channel_key, direction, status,
    value_aed, currency, submitted_at, transmitted_at, acknowledged_at,
    submitted_date_key, ttack_minutes, error_code
)
VALUES (
    %(client_invoice_id)s,
    (SELECT tenant_key  FROM reporting.dim_tenant  WHERE tenant_id   = %(tenant_id)s),
    (SELECT buyer_key   FROM reporting.dim_buyer   WHERE buyer_id    = %(buyer_id)s),
    (SELECT channel_key FROM reporting.dim_channel WHERE channel_code = %(channel_code)s),
    %(direction)s, %(status)s, %(value_aed)s, %(currency)s,
    %(submitted_at)s, %(transmitted_at)s, %(acknowledged_at)s,
    %(submitted_date_key)s, %(ttack_minutes)s, %(error_code)s
)
ON CONFLICT (tenant_key, client_invoice_id) DO UPDATE SET
    status            = EXCLUDED.status,
    value_aed         = EXCLUDED.value_aed,
    transmitted_at    = EXCLUDED.transmitted_at,
    acknowledged_at   = EXCLUDED.acknowledged_at,
    ttack_minutes     = EXCLUDED.ttack_minutes,
    error_code        = EXCLUDED.error_code,
    etl_loaded_at     = now();
"""


def run_db(args):
    src = _connect(os.environ["SOURCE_SECRET_ID"], readonly=True)
    tgt = _connect(os.environ["TARGET_SECRET_ID"], readonly=False)
    where = "" if args.full else "WHERE submitted_at >= %(since)s"
    params = {} if args.full else {"since": args.since}

    n_in = n_out = 0
    try:
        with src.cursor(name="src_stream") as scur:   # server-side cursor
            scur.itersize = 5000
            scur.execute(EXTRACT_SQL.format(where=where), params)
            cols = [d.name for d in scur.description]
            with tgt.cursor() as tcur:
                for raw in scur:
                    n_in += 1
                    fact = transform_row(dict(zip(cols, raw)))
                    tcur.execute(UPSERT_SQL, fact)
                    n_out += 1
                    if n_out % 5000 == 0:
                        tgt.commit()
        tgt.commit()
    except Exception:
        tgt.rollback()
        raise
    finally:
        src.close()
        tgt.close()
    print(f"ETL complete: read {n_in}, upserted {n_out}")
    return n_out


# --------------------------------------------------------------------------- #
# Local dev path — transform CSVs in place, no database required.
# Validates the transform logic against the generated sample data.
# --------------------------------------------------------------------------- #
def run_csv(args):
    data_dir = args.from_csv
    fact_path = os.path.join(data_dir, "fact_invoice.csv")
    with open(fact_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    def parse_ts(v):
        return datetime.fromisoformat(v) if v else None

    transformed = 0
    bad = 0
    for r in rows:
        try:
            raw = {
                "client_invoice_id": r["client_invoice_id"],
                "tenant_id": r["tenant_key"],          # sample data is pre-keyed
                "buyer_id": r["buyer_key"],
                "channel_code": r["channel_key"],
                "direction": r["direction"],
                "status": r["status"],
                "value_aed": r["value_aed"] or None,
                "currency": r["currency"] or None,
                "submitted_at": parse_ts(r["submitted_at"]),
                "transmitted_at": parse_ts(r["transmitted_at"]),
                "acknowledged_at": parse_ts(r["acknowledged_at"]),
                "error_code": r["error_code"] or None,
            }
            out = transform_row(raw)
            # sanity: derived columns agree with the generator
            if r["ttack_minutes"]:
                assert out["ttack_minutes"] == int(r["ttack_minutes"]), \
                    f"ttack mismatch for {r['client_invoice_id']}"
            assert out["submitted_date_key"] == int(r["submitted_date_key"])
            transformed += 1
        except AssertionError as e:
            bad += 1
            print(f"  VALIDATION FAIL: {e}", file=sys.stderr)
    print(f"CSV transform validated: {transformed} rows OK, {bad} failed")
    return 0 if bad == 0 else 1


def main():
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--full", action="store_true", help="full reload from source")
    g.add_argument("--since", help="incremental load: ISO date/datetime lower bound")
    g.add_argument("--from-csv", help="local dev: validate transform against CSV dir")
    args = p.parse_args()

    if args.from_csv:
        sys.exit(run_csv(args))
    else:
        if args.since:
            args.since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
        run_db(args)


if __name__ == "__main__":
    main()
