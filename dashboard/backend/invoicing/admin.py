from django.contrib import admin
from .models import (
    ClientGroup, Tenant, Buyer, Channel, Invoice, Transmission, RlsGrant,
)


class TransmissionInline(admin.TabularInline):
    model = Transmission
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("client_invoice_id", "tenant", "buyer", "direction", "status",
                    "value_aed", "submitted_at")
    list_filter = ("status", "direction", "tenant__integration_tier")
    search_fields = ("client_invoice_id", "tenant__name", "buyer__name")
    inlines = [TransmissionInline]


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("tenant_id", "name", "group", "integration_tier", "trn", "is_active")
    list_filter = ("integration_tier", "group")
    search_fields = ("tenant_id", "name", "trn")


@admin.register(Buyer)
class BuyerAdmin(admin.ModelAdmin):
    list_display = ("buyer_id", "name", "country", "is_peppol_registered")
    list_filter = ("is_peppol_registered", "country")


@admin.register(RlsGrant)
class RlsGrantAdmin(admin.ModelAdmin):
    list_display = ("principal", "tenant", "group")


admin.site.register(ClientGroup)
admin.site.register(Channel)
admin.site.register(Transmission)
