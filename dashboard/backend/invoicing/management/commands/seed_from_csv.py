"""
Seed the Django DB from the existing generated CSVs in dashboard/data, so the
same numbers carry over (9000 invoices, 6580 processed, PwC 1192).

It builds the per-hop Transmission records (the 5-corner FTA + Peppol legs) from
each invoice's status, making the diagram's acknowledgements first-class data.

    python manage.py seed_from_csv          # load from ../data
    python manage.py seed_from_csv --flush  # wipe invoicing tables first
"""
import csv
import datetime as dt
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.dateparse import parse_datetime

from invoicing.models import (
    ClientGroup, Tenant, Buyer, Channel, Invoice, Transmission, RlsGrant,
    CornerType, Leg, HopStatus,
)

DATA = Path(__file__).resolve().parents[4] / "data"


def read(name):
    with open(DATA / name, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _b(v):
    return v in ("True", "true", "1")


def _dt(v):
    return parse_datetime(v) if v else None


class Command(BaseCommand):
    help = "Load the generated sample CSVs into the TCA models."

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true", help="wipe invoicing tables first")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["flush"]:
            for m in (Transmission, Invoice, RlsGrant, Buyer, Channel, Tenant, ClientGroup):
                m.objects.all().delete()
            self.stdout.write("Flushed invoicing tables.")

        # --- dimensions ---
        groups = {}
        tenants = {}
        for r in read("dim_tenant.csv"):
            g, _ = ClientGroup.objects.get_or_create(
                group_id=r["group_account_id"],
                defaults={"name": r["group_account_name"]},
            )
            groups[r["group_account_id"]] = g
            t, _ = Tenant.objects.update_or_create(
                tenant_id=r["tenant_id"],
                defaults=dict(
                    name=r["tenant_name"], trn=r["trn"], group=g,
                    integration_tier=r["integration_tier"],
                    onboarded_date=r["onboarded_date"] or None,
                    is_active=_b(r["is_active"]),
                    corner=CornerType.SUPPLIER,
                ),
            )
            # key by surrogate key used in fact_invoice.csv
            tenants[r["tenant_key"]] = t

        buyers = {}
        for r in read("dim_buyer.csv"):
            b, _ = Buyer.objects.update_or_create(
                buyer_id=r["buyer_id"],
                defaults=dict(
                    name=r["buyer_name"], country=r["buyer_country"],
                    is_peppol_registered=_b(r["is_peppol_registered"]),
                    corner=CornerType.BUYER,
                ),
            )
            buyers[r["buyer_key"]] = b

        channels = {}
        for r in read("dim_channel.csv"):
            c, _ = Channel.objects.update_or_create(
                code=r["channel_code"],
                defaults=dict(name=r["channel_name"], integration_tier=r["integration_tier"]),
            )
            channels[r["channel_key"]] = c

        # --- invoices + per-hop transmissions ---
        Invoice.objects.all().delete()  # idempotent reload of facts
        inv_objs, tx_objs = [], []
        for r in read("fact_invoice.csv"):
            inv = Invoice(
                client_invoice_id=r["client_invoice_id"],
                tenant=tenants[r["tenant_key"]],
                buyer=buyers.get(r["buyer_key"]),
                channel=channels[r["channel_key"]],
                direction=r["direction"],
                status=r["status"],
                value_aed=(r["value_aed"] or None),
                currency=r["currency"],
                submitted_at=_dt(r["submitted_at"]),
                ttack_minutes=(int(r["ttack_minutes"]) if r["ttack_minutes"] else None),
                error_code=r["error_code"],
            )
            inv_objs.append((inv, r))

        Invoice.objects.bulk_create([i for i, _ in inv_objs], batch_size=1000)

        # Re-fetch ids for transmission FKs (bulk_create on SQLite sets pk).
        for inv, r in inv_objs:
            tx_objs.extend(self._build_transmissions(inv, r))
        Transmission.objects.bulk_create(tx_objs, batch_size=1000)

        # --- RLS grants ---
        for r in read("rls_user_grant.csv"):
            tenant = group = None
            if r["tenant_id"]:
                tenant = Tenant.objects.filter(tenant_id=r["tenant_id"]).first()
            if r["group_account_id"]:
                group = ClientGroup.objects.filter(group_id=r["group_account_id"]).first()
            if tenant or group:
                RlsGrant.objects.get_or_create(
                    principal=r["quicksight_principal"], tenant=tenant, group=group)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded: {Tenant.objects.count()} tenants, {Buyer.objects.count()} buyers, "
            f"{Invoice.objects.count()} invoices, {Transmission.objects.count()} transmissions, "
            f"{RlsGrant.objects.count()} RLS grants."))

    def _build_transmissions(self, inv, r):
        """Derive the FTA + Peppol hop records from the invoice's stored status."""
        submitted = _dt(r["submitted_at"])
        transmitted = _dt(r["transmitted_at"])
        acked = _dt(r["acknowledged_at"])
        status = r["status"]
        out = []

        # FTA leg: Corner 2 -> Corner 5 (Tax Data Document).
        fta = Transmission(invoice=inv, leg=Leg.FTA,
                           from_corner=CornerType.ASP, to_corner=CornerType.FTA)
        # Peppol leg: Corner 2 -> Corner 3 -> Corner 4.
        peppol = Transmission(invoice=inv, leg=Leg.PEPPOL,
                              from_corner=CornerType.ASP, to_corner=CornerType.BUYER)

        if status == "fta_acknowledged":
            fta.status = HopStatus.ACKNOWLEDGED; fta.sent_at = transmitted; fta.acknowledged_at = acked
            fta.fta_ack_reference = f"TDD-{inv.client_invoice_id}"
            peppol.status = HopStatus.ACKNOWLEDGED; peppol.sent_at = transmitted; peppol.acknowledged_at = acked
            peppol.peppol_message_id = f"PEPPOL-{inv.client_invoice_id}"
        elif status == "transmitted":
            fta.status = HopStatus.SENT; fta.sent_at = transmitted
            peppol.status = HopStatus.SENT; peppol.sent_at = transmitted
            peppol.peppol_message_id = f"PEPPOL-{inv.client_invoice_id}"
        elif status in ("submitted", "validation_failed"):
            fta.status = HopStatus.PENDING
            peppol.status = HopStatus.PENDING
            if status == "validation_failed":
                fta.error_code = peppol.error_code = r["error_code"]
        elif status == "rejected":
            fta.status = HopStatus.SENT; fta.sent_at = transmitted
            peppol.status = HopStatus.FAILED; peppol.sent_at = transmitted
            peppol.error_code = r["error_code"]

        out.extend([fta, peppol])
        return out
