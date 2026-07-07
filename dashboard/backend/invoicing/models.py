"""
Data model for the Suntech TCA platform — encodes the 5-corner model from the
"Deep dive into ERP Native E-Invoicing Integration" diagram literally.

The diagram:

    Client ERP (Corner 1) ──send──▶ Suntech TCA Platform (Corner 2)
                          ◀──ack──
    TCA ──send──▶ UAE FTA (Corner 5)            [Tax Data Document]
        ◀──ack──
    TCA ──send──▶ Peppol Network (Corner 3) ──▶ Buyer (Corner 4)
        ◀──ack── (per hop)

So every invoice has TWO outbound legs from the ASP, each with its own
send + acknowledgement: the FTA leg (Corner 5) and the Peppol leg
(Corner 3 → Corner 4). We model the corners as entities and each hop as an
explicit Transmission record with send/ack timestamps and status.
"""
from django.db import models


# --------------------------------------------------------------------------- #
# Corner entities
# --------------------------------------------------------------------------- #
class CornerType(models.TextChoices):
    SUPPLIER = "C1", "Corner 1 — Supplier (client)"
    ASP = "C2", "Corner 2 — Suntech ASP"
    PEPPOL = "C3", "Corner 3 — Peppol Network (buyer's ASP)"
    BUYER = "C4", "Corner 4 — Buyer (receiver)"
    FTA = "C5", "Corner 5 — UAE FTA"


class IntegrationTier(models.TextChoices):
    EMBEDDED = "Embedded", "Suntech Embedded"
    MANAGED = "Managed", "Suntech Managed"
    CONNECT = "Connect", "Suntech Connect"
    PORTAL = "Portal", "User Portal"


class ClientGroup(models.Model):
    """A client account (parent) that holds multiple tenants — the group rollup."""
    group_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=256)

    def __str__(self):
        return self.name


class Tenant(models.Model):
    """Corner 1 — a legal entity / supplier. One Suntech tenant per entity."""
    tenant_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=256)
    trn = models.CharField("UAE Tax Registration Number", max_length=20, blank=True)
    group = models.ForeignKey(ClientGroup, on_delete=models.PROTECT, related_name="tenants")
    integration_tier = models.CharField(max_length=16, choices=IntegrationTier.choices)
    onboarded_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    corner = models.CharField(max_length=2, choices=CornerType.choices, default=CornerType.SUPPLIER)

    def __str__(self):
        return self.name


class Buyer(models.Model):
    """Corner 4 — the receiving party. Peppol-registration drives the interop gap."""
    buyer_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=256)
    country = models.CharField(max_length=2, blank=True)
    is_peppol_registered = models.BooleanField(default=True)
    corner = models.CharField(max_length=2, choices=CornerType.choices, default=CornerType.BUYER)

    def __str__(self):
        return self.name


class Channel(models.Model):
    """The send channel an invoice came in on (per the integration tiers)."""
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=64)
    integration_tier = models.CharField(max_length=16, choices=IntegrationTier.choices)

    def __str__(self):
        return self.name


# --------------------------------------------------------------------------- #
# Invoice (the document moving through the corners)
# --------------------------------------------------------------------------- #
class Direction(models.TextChoices):
    AR = "AR", "AR (Sales / Outbound)"
    AP = "AP", "AP (Purchase / Inbound)"


class InvoiceStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    VALIDATION_FAILED = "validation_failed", "Validation failed"
    TRANSMITTED = "transmitted", "Transmitted"
    FTA_ACKNOWLEDGED = "fta_acknowledged", "FTA-acknowledged"
    REJECTED = "rejected", "Rejected"


class Invoice(models.Model):
    """
    One invoice. The headline 'processed' KPI = status FTA_ACKNOWLEDGED.
    Idempotency mirrors the platform: client_invoice_id unique per tenant.
    """
    client_invoice_id = models.CharField(max_length=128)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="invoices")
    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, related_name="invoices",
                              null=True, blank=True)
    channel = models.ForeignKey(Channel, on_delete=models.PROTECT, related_name="invoices")

    direction = models.CharField(max_length=2, choices=Direction.choices)
    status = models.CharField(max_length=24, choices=InvoiceStatus.choices)

    value_aed = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True)

    # Corner 1 → Corner 2 leg.
    submitted_at = models.DateTimeField()
    # Cached overall ack time (submitted → FTA ack) in minutes, for analytics.
    ttack_minutes = models.IntegerField(null=True, blank=True)
    error_code = models.CharField(max_length=32, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "client_invoice_id"],
                                    name="uq_invoice_per_tenant"),
        ]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["direction"]),
            models.Index(fields=["submitted_at"]),
        ]

    def __str__(self):
        return self.client_invoice_id

    @property
    def is_processed(self):
        return self.status == InvoiceStatus.FTA_ACKNOWLEDGED


# --------------------------------------------------------------------------- #
# Per-hop transmissions (the send + acknowledgement on each leg of the diagram)
# --------------------------------------------------------------------------- #
class Leg(models.TextChoices):
    FTA = "FTA", "TCA → FTA (Corner 5)"
    PEPPOL = "PEPPOL", "TCA → Peppol → Buyer (Corner 3→4)"


class HopStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    SENT = "sent", "Sent"
    ACKNOWLEDGED = "acknowledged", "Acknowledged"
    FAILED = "failed", "Failed"


class Transmission(models.Model):
    """
    One outbound hop for an invoice, with its own send + acknowledgement.
    The diagram shows two legs from the ASP, each with send + ack:
      * FTA leg    — Tax Data Document (TDD) to Corner 5
      * Peppol leg — AS4 to Corner 3, delivered to Corner 4
    This makes the 5-corner acknowledgements first-class, queryable data.
    """
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="transmissions")
    leg = models.CharField(max_length=8, choices=Leg.choices)
    from_corner = models.CharField(max_length=2, choices=CornerType.choices)
    to_corner = models.CharField(max_length=2, choices=CornerType.choices)

    status = models.CharField(max_length=16, choices=HopStatus.choices, default=HopStatus.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    # Reference ids the platform records per hop.
    peppol_message_id = models.CharField(max_length=128, blank=True)
    fta_ack_reference = models.CharField(max_length=128, blank=True)
    error_code = models.CharField(max_length=32, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["invoice", "leg"], name="uq_transmission_leg"),
        ]

    def __str__(self):
        return f"{self.invoice.client_invoice_id} [{self.leg}] {self.status}"


# --------------------------------------------------------------------------- #
# Row-level security grants (mirrors the QuickSight RLS dataset)
# --------------------------------------------------------------------------- #
class RlsGrant(models.Model):
    """Which principal may see which tenant (or whole group)."""
    principal = models.CharField(max_length=256)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, null=True, blank=True)
    group = models.ForeignKey(ClientGroup, on_delete=models.CASCADE, null=True, blank=True)

    def __str__(self):
        scope = self.tenant or self.group or "ALL"
        return f"{self.principal} → {scope}"
