from rest_framework import serializers
from .models import Invoice, Tenant, Transmission


class TransmissionSerializer(serializers.ModelSerializer):
    leg_label = serializers.CharField(source="get_leg_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Transmission
        fields = [
            "leg", "leg_label", "from_corner", "to_corner", "status", "status_label",
            "sent_at", "acknowledged_at", "peppol_message_id", "fta_ack_reference",
            "error_code",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    # Flattened fields the frontend uses (matches the old dataset.json shape).
    tenant_id = serializers.CharField(source="tenant.tenant_id", read_only=True)
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    group_account_id = serializers.CharField(source="tenant.group.group_id", read_only=True)
    group_account_name = serializers.CharField(source="tenant.group.name", read_only=True)
    integration_tier = serializers.CharField(source="tenant.integration_tier", read_only=True)
    trn = serializers.CharField(source="tenant.trn", read_only=True)
    buyer_id = serializers.CharField(source="buyer.buyer_id", read_only=True, default=None)
    buyer_name = serializers.SerializerMethodField()
    buyer_country = serializers.CharField(source="buyer.country", read_only=True, default=None)
    is_peppol_registered = serializers.BooleanField(source="buyer.is_peppol_registered",
                                                    read_only=True, default=True)
    channel_code = serializers.CharField(source="channel.code", read_only=True)
    channel_name = serializers.CharField(source="channel.name", read_only=True)
    is_processed = serializers.SerializerMethodField()
    is_failed = serializers.SerializerMethodField()
    processed_value_aed = serializers.SerializerMethodField()
    submitted_year_month = serializers.SerializerMethodField()
    submitted_date = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "client_invoice_id", "tenant_id", "tenant_name", "group_account_id",
            "group_account_name", "integration_tier", "trn",
            "buyer_id", "buyer_name", "buyer_country", "is_peppol_registered",
            "channel_code", "channel_name", "direction", "status",
            "is_processed", "is_failed", "value_aed", "currency",
            "processed_value_aed", "submitted_at", "submitted_date",
            "submitted_year_month", "ttack_minutes", "error_code",
        ]

    def get_buyer_name(self, obj):
        return obj.buyer.name if obj.buyer_id else "Unknown buyer"

    def get_is_processed(self, obj):
        return 1 if obj.status == "fta_acknowledged" else 0

    def get_is_failed(self, obj):
        return 1 if obj.status in ("validation_failed", "rejected") else 0

    def get_processed_value_aed(self, obj):
        return obj.value_aed if obj.status == "fta_acknowledged" else None

    def get_submitted_year_month(self, obj):
        return obj.submitted_at.strftime("%Y-%m")

    def get_submitted_date(self, obj):
        return obj.submitted_at.strftime("%Y-%m-%d")


class InvoiceDetailSerializer(InvoiceSerializer):
    transmissions = TransmissionSerializer(many=True, read_only=True)

    class Meta(InvoiceSerializer.Meta):
        fields = InvoiceSerializer.Meta.fields + ["transmissions"]


class TenantSerializer(serializers.ModelSerializer):
    group_account_id = serializers.CharField(source="group.group_id", read_only=True)
    group_account_name = serializers.CharField(source="group.name", read_only=True)

    class Meta:
        model = Tenant
        fields = ["tenant_id", "name", "trn", "group_account_id", "group_account_name",
                  "integration_tier"]
