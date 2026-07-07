from rest_framework.pagination import PageNumberPagination


class ConfigurablePagination(PageNumberPagination):
    """Default 50/page for the invoice table, but allow the frontend store to
    pull larger pages (up to 1000) when hydrating all scoped rows."""
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 1000
