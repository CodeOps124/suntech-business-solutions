from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r"invoices", views.InvoiceViewSet, basename="invoice")
router.register(r"tenants", views.TenantViewSet, basename="tenant")

urlpatterns = [
    path("analytics/summary", views.analytics_summary, name="analytics-summary"),
    path("pipeline/summary", views.pipeline_summary, name="pipeline-summary"),
    path("", include(router.urls)),
]
