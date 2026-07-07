"""
Row-level security resolution — mirrors the QuickSight dataset-layer RLS.

The principal arrives via the `X-Principal` header (DEMO: trusted; in production
derive it from the authenticated session / SSO). We resolve it to the set of
tenant ids it may see and filter every queryset by that set. A principal with no
grants sees nothing; an admin grant (principal with neither tenant nor group on
a row, configured below) sees everything.
"""
from .models import RlsGrant, Tenant

# Demo: principals that are full-access admins (internal "all clients" view).
ADMIN_PRINCIPALS = {"admin@suntech-global.com"}


def allowed_tenant_ids(principal: str | None):
    """Return a set of tenant_id strings the principal may access, or None=all."""
    if principal in ADMIN_PRINCIPALS:
        return None  # None means "no restriction" (admin)

    if not principal:
        return set()  # unknown principal sees nothing

    ids = set()
    grants = RlsGrant.objects.filter(principal=principal).select_related("tenant", "group")
    for g in grants:
        if g.tenant_id:
            ids.add(g.tenant.tenant_id)
        elif g.group_id:
            ids.update(
                Tenant.objects.filter(group=g.group).values_list("tenant_id", flat=True)
            )
    return ids


def scope_invoices(qs, principal):
    """Filter an Invoice queryset to the principal's allowed tenants."""
    allowed = allowed_tenant_ids(principal)
    if allowed is None:
        return qs
    return qs.filter(tenant__tenant_id__in=allowed)
