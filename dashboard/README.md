# Suntech P&L Invoice Analytics Dashboard

A management dashboard on **Amazon QuickSight** that lets Suntech's internal P&L
leads answer questions like:

> *"As a P&L lead for e-invoicing at Suntech, how many invoices were processed
> through my ASP?"*
> *"...how many for the customers of PwC?"*

This is the project scoped in [../docs/PROJECT_OVERVIEW.md](../docs/PROJECT_OVERVIEW.md) → *"Current Project: P&L Invoice
Analytics Dashboard"*. Everything here implements that spec; design decisions
that the spec left open were confirmed before building (see
[Scope decisions](#scope-decisions)).

> **Status:** standalone project. It reads from a **read-only replica** of TCA's
> data store and **never touches the primary production database**. The audience
> is internal Suntech P&L leads, **not clients**. Not integrated into the TCA
> platform or the client-facing Web Portal (that is Phase 7, future/optional).

---

## Scope decisions

Confirmed with the stakeholder before any build (the spec's *Open Questions*):

| Question | Decision used here |
|---|---|
| BI tool | **Amazon QuickSight** (Power BI was dropped in the spec) |
| Definition of "processed" | **FTA-acknowledged** is the headline KPI; submitted & transmitted shown as a funnel |
| "Customers of X" | **X's own buyers** (Corner 4) — drives the Tenant Explorer page |
| Counts vs value | **Counts + value (AED)**; value visuals degrade gracefully to counts if value data is absent (`value_aed` is nullable) |

---

## What's in here

```
dashboard/
├── sql/                        Reporting star schema + QuickSight views + loader
│   ├── 01_reporting_schema.sql   star schema DDL (fact_invoice + 4 dims)
│   ├── 02_quicksight_views.sql   v_invoice_detail, RLS rules, reconciliation
│   └── 03_load_sample_data.sql   \copy the generated CSVs in (local/demo)
├── etl/
│   ├── generate_sample_data.py   dependency-free sample data (incl. a PwC tenant)
│   └── etl_transform.py          source replica -> star schema (UPSERT, idempotent)
├── quicksight/                 QuickSight asset definitions (create-* API JSON)
│   ├── 00_datasource_postgres.json
│   ├── 01_dataset_invoice_detail.json   (SPICE, RLS-protected, calculated fields)
│   ├── 02_dataset_rls.json
│   └── 03_analysis_definition.json       (4 pages, shared global filter bar)
├── iac/
│   ├── refresh_pipeline.yaml      EventBridge -> Step Functions -> SPICE + SNS
│   └── upload_scan_baseline.yaml  KMS, S3, GuardDuty malware scan, access logs
├── scripts/                    deploy + refresh + helpers
├── web/                        React ERP frontend (analytics UI + invoices)
└── docs/                       prerequisites mapping, security checklist, deploy
```

## Visual frontend (the UI you can open in a browser)

A React ERP app lives in [web/](web/). It renders the analytics as real charts
(KPI cards, trends, the PwC buyer breakdown), plus an invoice list/detail module
and the ERP shell — tenant-scoped from day one. It runs locally with no AWS, and
embeds the live QuickSight dashboard once a backend embed endpoint is set.

```bash
cd web && npm install && npm run dev    # http://localhost:5173
```

See [web/README.md](web/README.md). The analytics page uses the same numbers as
the QuickSight dashboard and the Python preview (6,580 processed; 1,192 for PwC).

## Data model (star schema)

`fact_invoice` (grain = one invoice) joined to `dim_tenant` (with a
**parent/group rollup** for multi-entity clients), `dim_buyer`, `dim_date`,
`dim_channel`. Status values mirror the platform's own per-invoice outcomes
(`submitted / validation_failed / transmitted / fta_acknowledged / rejected`).

> This project **reads** the status already assigned by the live TCA Platform and
> aggregates it for reporting. It does **not** re-sort or re-derive invoice
> status — that already happens inside the platform (see the Conceptual Note in
> [../docs/PROJECT_OVERVIEW.md](../docs/PROJECT_OVERVIEW.md)).

## Dashboard pages

1. **Executive Overview** — KPI cards (processed, processed value, avg
   time-to-acknowledge, rejection rate), trend by status, tier & status
   breakdowns, top tenants.
2. **Tenant Explorer** — pick a tenant → its volume, AR/AP split, trend, and a
   **breakdown of its own buyers**. This is what answers *"customers of PwC."*
3. **Operational Health** — rejection-rate trend, error-code breakdown,
   time-to-acknowledge distribution, failures by channel, and the Peppol
   interop-gap view (buyer not yet on the network).
4. **Commercial / Revenue** *(conditional on value data)* — processed value by
   tier and by client group, value trend.

All pages share one global filter bar: **date range, tenant, AR/AP**.

## Quick start (local, no AWS)

```bash
cd dashboard/etl
python generate_sample_data.py          # writes CSVs to ../data
python etl_transform.py --from-csv ../data   # validates the transform logic
```

Then load into a local Postgres to preview the exact data QuickSight will read:

```bash
psql -f sql/01_reporting_schema.sql
psql -f sql/02_quicksight_views.sql
psql -f sql/03_load_sample_data.sql      # prints reconciliation totals
```

Sample control totals (seed-fixed, for Phase 5 reconciliation):
`9000` total invoices · `6580` processed · `1192` processed for PwC.

## Deploy to AWS

See [`docs/DEPLOY.md`](docs/DEPLOY.md). Short version:

```bash
# 1. infra (region me-central-1 / Dubai)
aws cloudformation deploy --template-file iac/upload_scan_baseline.yaml ...
aws cloudformation deploy --template-file iac/refresh_pipeline.yaml ...
# 2. QuickSight assets
AWS_ACCOUNT_ID=... QS_ADMIN_ARN=... scripts/deploy_quicksight.sh
# 3. first SPICE load
AWS_ACCOUNT_ID=... scripts/refresh_spice.sh
```

## Security & compliance

This project inherits the same "Suntech always owns" bar as the core platform
(it touches the same regulated client data). See
[`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md) — the headline is
**row-level security enforced at the data layer, not the UI**, UAE data
residency, least-privilege ETL roles, and malware-scanned upload paths.

## Prerequisites

Both the common client prerequisites and this project's own infra prerequisites
are mapped, line by line, in
[`docs/PREREQUISITES.md`](docs/PREREQUISITES.md).
