from django.db.models import Count, Sum, Q, Avg
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, mixins
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Invoice, Tenant
from .serializers import InvoiceSerializer, InvoiceDetailSerializer, TenantSerializer
from .rls import scope_invoices, allowed_tenant_ids


def _principal(request):
    return request.headers.get("X-Principal") or request.query_params.get("principal")


def _base_qs(request):
    qs = Invoice.objects.select_related("tenant", "tenant__group", "buyer", "channel")
    qs = scope_invoices(qs, _principal(request))
    p = request.query_params
    if p.get("tenant_id"):
        qs = qs.filter(tenant__tenant_id=p["tenant_id"])
    if p.get("direction"):
        qs = qs.filter(direction=p["direction"])
    if p.get("status"):
        qs = qs.filter(status=p["status"])
    return qs


class InvoiceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """List + detail of invoices, RLS-scoped. Detail includes per-hop transmissions."""
    lookup_field = "client_invoice_id"
    lookup_value_regex = "[^/]+"

    def get_queryset(self):
        qs = _base_qs(self.request).order_by("-submitted_at")
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(client_invoice_id__icontains=search)
                | Q(buyer__name__icontains=search)
                | Q(tenant__name__icontains=search)
            )
        return qs

    def get_serializer_class(self):
        return InvoiceDetailSerializer if self.action == "retrieve" else InvoiceSerializer

    def get_object(self):
        # Scope first, then 404 if not in scope — a cross-tenant id looks like
        # "not found", never a server error and never another tenant's data.
        qs = scope_invoices(
            Invoice.objects.select_related("tenant", "tenant__group", "buyer", "channel")
            .prefetch_related("transmissions"),
            _principal(self.request),
        )
        return get_object_or_404(qs, client_invoice_id=self.kwargs["client_invoice_id"])


class TenantViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Tenants the principal may see."""
    serializer_class = TenantSerializer
    pagination_class = None

    def get_queryset(self):
        allowed = allowed_tenant_ids(_principal(self.request))
        qs = Tenant.objects.select_related("group").order_by("name")
        if allowed is not None:
            qs = qs.filter(tenant_id__in=allowed)
        return qs


@api_view(["GET"])
def analytics_summary(request):
    """KPIs + grouped breakdowns the dashboard pages need, computed in the DB."""
    qs = _base_qs(request)
    agg = qs.aggregate(
        total=Count("id"),
        processed=Count("id", filter=Q(status="fta_acknowledged")),
        failed=Count("id", filter=Q(status__in=["validation_failed", "rejected"])),
        processed_value=Sum("value_aed", filter=Q(status="fta_acknowledged")),
        any_value=Count("id", filter=Q(value_aed__isnull=False)),
        avg_ttack=Avg("ttack_minutes"),
    )
    total = agg["total"] or 0

    by_tier = [
        {"name": r["tenant__integration_tier"], "value": r["value"]}
        for r in qs.filter(status="fta_acknowledged")
        .values("tenant__integration_tier").annotate(value=Count("id")).order_by("-value")
    ]
    by_status = [
        {"name": r["status"], "value": r["value"]}
        for r in qs.values("status").annotate(value=Count("id")).order_by("-value")
    ]
    top_tenants = [
        {"name": r["tenant__name"], "value": r["value"]}
        for r in qs.filter(status="fta_acknowledged")
        .values("tenant__name").annotate(value=Count("id")).order_by("-value")[:10]
    ]
    trend = {}
    for r in qs.values("submitted_at__year", "submitted_at__month").annotate(
        processed=Count("id", filter=Q(status="fta_acknowledged")),
        failed=Count("id", filter=Q(status__in=["validation_failed", "rejected"])),
        value=Sum("value_aed", filter=Q(status="fta_acknowledged")),
    ):
        ym = f"{r['submitted_at__year']:04d}-{r['submitted_at__month']:02d}"
        trend[ym] = {"name": ym, "processed": r["processed"], "failed": r["failed"],
                     "value": float(r["value"] or 0)}

    return Response({
        "total": total,
        "processed": agg["processed"] or 0,
        "failed": agg["failed"] or 0,
        "processed_value": float(agg["processed_value"] or 0),
        "has_value": (agg["any_value"] or 0) > 0,
        "rejection_rate": (agg["failed"] / total * 100) if total else 0,
        "avg_ttack": float(agg["avg_ttack"] or 0),
        "by_tier": by_tier,
        "by_status": by_status,
        "top_tenants": top_tenants,
        "trend": sorted(trend.values(), key=lambda x: x["name"]),
    })


# Auto-remediation rules (mirror the frontend pipeline engine, server-side).
AUTO_FIXABLE = {"E-PINT-MANDATORY", "E-TRN-INVALID", "E-TAXCAT-MISSING"}
NON_REMEDIABLE_REJECT = {"R-BUYER-NOT-REGISTERED"}


@api_view(["GET"])
def pipeline_summary(request):
    """The automated 5-corner pipeline outcome, computed over the scoped data."""
    qs = _base_qs(request)
    funnel = [0, 0, 0, 0]
    acknowledged = in_flight = auto_remediated = exceptions = 0
    remediation = {}
    exception_list = []

    for inv in qs.iterator():
        status, err = inv.status, inv.error_code
        reason = None
        if status == "fta_acknowledged":
            reach, terminal, remed, exc = 3, "ack", False, False
        elif status == "transmitted":
            reach, terminal, remed, exc = 2, "flight", False, False
        elif status == "submitted":
            reach, terminal, remed, exc = 0, "flight", False, False
        elif status == "validation_failed":
            if err in AUTO_FIXABLE:
                reach, terminal, remed, exc = 3, "ack", True, False
            else:
                reach, terminal, remed, exc = 0, "exc", False, True
                reason = err or "Validation error (source fix required)"
        elif status == "rejected":
            if err in NON_REMEDIABLE_REJECT:
                reach, terminal, remed, exc = 1, "exc", False, True
                reason = "Buyer not on Peppol (market-readiness gap)"
            else:
                reach, terminal, remed, exc = 3, "ack", True, False
        else:
            reach, terminal, remed, exc = 0, "flight", False, False

        for s in range(reach + 1):
            funnel[s] += 1
        if terminal == "ack":
            acknowledged += 1
        elif terminal == "flight":
            in_flight += 1
        if remed:
            auto_remediated += 1
            key = err or "auto-retry"
            remediation[key] = remediation.get(key, 0) + 1
        if exc:
            exceptions += 1
            if len(exception_list) < 200:
                exception_list.append({
                    "client_invoice_id": inv.client_invoice_id,
                    "tenant_name": inv.tenant.name,
                    "buyer_name": inv.buyer.name if inv.buyer_id else "Unknown buyer",
                    "status": inv.status,
                    "reason": reason,
                })

    total = funnel[0]
    straight_through = acknowledged - auto_remediated
    stages = ["Submitted", "Validated", "Transmitted", "FTA-acknowledged"]
    return Response({
        "total": total,
        "funnel": [{"name": stages[i], "value": funnel[i]} for i in range(4)],
        "acknowledged": acknowledged,
        "in_flight": in_flight,
        "auto_remediated": auto_remediated,
        "exceptions": exceptions,
        "straight_through": straight_through,
        "automation_rate": ((acknowledged + in_flight) / total * 100) if total else 0,
        "stp_rate": (straight_through / total * 100) if total else 0,
        "remediation_by_type": sorted(
            [{"name": k, "value": v} for k, v in remediation.items()],
            key=lambda x: -x["value"]),
        "exception_list": exception_list,
    })
