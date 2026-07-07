# Suntech TCA — Django Backend (API)

Django + Django REST Framework backend for the TCA platform. It replaces the
frontend's static `dataset.json` with a real DB-backed API: ORM models, the
Django admin, migrations, and RLS-scoped REST endpoints.

The data model encodes the **5-corner e-invoicing diagram** literally (see
[`invoicing/models.py`](invoicing/models.py)).

## The data model (mirrors the TCA diagram)

```
Client ERP (Corner 1) ──send──▶ Suntech TCA / ASP (Corner 2)
                      ◀──ack──
   TCA ──send──▶ UAE FTA (Corner 5)              [Tax Data Document]
       ◀──ack──
   TCA ──send──▶ Peppol Network (Corner 3) ──▶ Buyer (Corner 4)
       ◀──ack── (per hop)
```

- **Corner entities**: `Tenant` (C1 supplier), the ASP (C2, implicit = Suntech),
  `Buyer` (C4), plus `ClientGroup` for the multi-entity rollup.
- **`Invoice`** — the document; idempotent per tenant (`client_invoice_id`).
- **`Transmission`** — each invoice has **two** outbound legs, each with its own
  send + acknowledgement, exactly as the diagram shows:
  - **FTA leg** (C2→C5): the Tax Data Document + FTA ack reference.
  - **Peppol leg** (C2→C3→C4): the AS4 send + Peppol message id.
- **`RlsGrant`** — which principal may see which tenant/group (mirrors the
  QuickSight RLS dataset).

So the 5-corner acknowledgements are first-class, queryable rows — not just a
status string.

## Run it

```bash
cd dashboard/backend
py -m venv .venv                      # Python 3.12 via the py launcher
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py seed_from_csv --flush   # loads ../data/*.csv
.venv/Scripts/python manage.py runserver 8000
```

The frontend (`dashboard/web`) auto-detects the API on `http://localhost:8000`
and switches its top-bar badge from "local data" to "Django API". If the backend
isn't running, the frontend falls back to the bundled sample data — so either
works.

Optional admin UI: `manage.py createsuperuser`, then `/admin/` to browse
invoices + their per-hop transmissions.

## Seeding

`seed_from_csv` loads the existing generated CSVs in `../data` so the numbers
match everything else in the project (9,000 invoices · 6,580 processed · PwC
1,192). It also synthesizes the two `Transmission` legs per invoice from the
stored status. Re-runnable; `--flush` wipes first.

## API

All endpoints take the principal via the `X-Principal` header (or `?principal=`
for quick testing). Results are **RLS-scoped server-side** — a principal never
receives data outside its grants.

| Endpoint | Purpose |
|---|---|
| `GET /api/invoices/` | Paginated invoice list (`?tenant_id=&direction=&status=&search=&page_size=`) |
| `GET /api/invoices/{client_invoice_id}/` | Invoice detail incl. the 2 transmission legs |
| `GET /api/tenants/` | Tenants the principal may see |
| `GET /api/analytics/summary` | KPIs + breakdowns for the dashboard pages |
| `GET /api/pipeline/summary` | Automated 5-corner pipeline outcome + exceptions |

Cross-tenant access returns **404** (looks like "not found", never another
tenant's data, never a 500).

## Security notes (demo vs production)

- **Principal trust**: the `X-Principal` header is trusted for the demo. In
  production, derive the principal from the authenticated session / SSO / JWT and
  drop header trust.
- **DB**: SQLite for local dev. Point `DATABASES` at the Postgres reporting
  replica for the real deployment (the model maps cleanly).
- `DEBUG`, `SECRET_KEY`, and `ALLOWED_HOSTS` must be hardened before any non-local
  use. See [`.env.example`](.env.example).

## Layout

```
backend/
├── manage.py
├── requirements.txt
├── tca_backend/            project (settings, urls, wsgi/asgi)
└── invoicing/              the app
    ├── models.py           5-corner data model
    ├── serializers.py      DRF serializers (flattened to the frontend shape)
    ├── views.py            viewsets + analytics/pipeline aggregations
    ├── rls.py              principal → allowed tenants
    ├── pagination.py       configurable page size
    ├── admin.py            browsable admin
    └── management/commands/seed_from_csv.py
```
