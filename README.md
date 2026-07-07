# SunTech Business Solutions

Engineering workspace for SunTech Business Solutions DMCC — an accredited Access
Service Provider (ASP) for UAE e-invoicing. Clients route invoices through
SunTech's **Tax Compliance Agent (TCA)** platform, which reports to the Federal
Tax Authority (FTA) and delivers invoices over the Peppol network.

## Repository layout

| Path | Contents |
|---|---|
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Platform reference: the 5-corner model, integration tiers, cross-cutting technical contracts, and the current project spec |
| [dashboard/](dashboard/) | **P&L Invoice Analytics Dashboard** — reporting star schema, ETL, QuickSight asset definitions, IaC templates, Django API, and React frontend |

## Current project: P&L Invoice Analytics Dashboard

A management dashboard on Amazon QuickSight (region `me-central-1`, UAE) for
internal P&L leads. It reads from a read-only replica of the TCA data store,
never the primary production database, and enforces row-level security at the
data layer.

Start with [dashboard/README.md](dashboard/README.md) — it covers the local
quick start (sample data generation + Postgres preview), the React frontend,
and AWS deployment.

```bash
# local preview, no AWS required
cd dashboard/etl
python generate_sample_data.py           # writes CSVs to ../data
python etl_transform.py --from-csv ../data

cd ../web
npm install && npm run dev               # http://localhost:5173
```

## Conventions

- Sample/demo data is generated, not committed — `dashboard/data/` is ignored.
- Secrets never enter the repo: copy the `.env.example` files and fill them in
  locally.
- All infrastructure targets AWS `me-central-1` (UAE) for data residency.
