# Suntech TCA — Web Frontend (ERP shell + Analytics)

A React frontend for the Suntech Tax Compliance Agent platform. It's the
**visual** front door to the P&L invoice analytics (and the first ERP modules),
built so it runs locally with **no AWS**, yet drops into the live Amazon
QuickSight embed the moment a backend embed endpoint is configured.

> This is the proper UI you can open in a browser — not the terminal preview.

## Run it

```bash
cd dashboard/web
npm install
npm run dev            # opens http://localhost:5173
```

### With the Django backend (real data)

By default the app uses the **Django API** at `http://localhost:8000` when it's
running, and falls back to bundled sample data otherwise. The top-bar badge shows
which is live ("● Django API" vs "● local data"). To use the real API:

```bash
# terminal 1 — backend (see ../backend/README.md)
cd ../backend && .venv/Scripts/python manage.py runserver 8000
# terminal 2 — frontend
npm run dev
```

With the backend up, tenant scoping (RLS) is enforced **server-side** — the
browser never receives data outside the signed-in principal's scope.

`npm run dev` regenerates `src/data/dataset.json` from the sample CSVs in
`../data` first (via `scripts/build-data.mjs`), so the charts always reflect the
current sample data. To regenerate the underlying data, re-run the Python
generator in `../etl` then `npm run build-data`.

Build for production: `npm run build` → static files in `dist/`.

## What's in it

**ERP shell** — branded Suntech sidebar; **all modules are live**:

- **Analytics** — the 4-page P&L dashboard (below).
- **Invoices (AR/AP)** — searchable list + invoice detail with the 5-corner
  lifecycle.
- **Processing (auto)** — the automated TCA pipeline monitor. Invoices flow
  through the 5 corners (Submitted → Validated → Transmitted → FTA-acknowledged)
  with **no manual approval**; the Gap Analyzer + retry logic auto-remediate
  fixable failures, and only truly-stuck invoices (e.g. buyer not on Peppol)
  surface as exceptions. Includes a "Replay automated run" animation.
- **Legal Entities** — per-tenant rollup.
- **Master Data** — customers, legal entities (TRN / trade licence / address +
  a data-readiness score for the Gap Analyzer), and the item→UAE-tax-category
  catalogue.
- **Receivables (AR)** / **Payables (AP)** — directional invoice ops with KPIs
  and an aging distribution.
- **Settings** — integration method + receive channel per entity, users &
  access (RLS), and read-only compliance/residency facts.

Every module reads through the same tenant-scoped data layer, so all of them
respect RLS.

**Analytics module** — the four pages from the project spec, as tabs:
1. Executive Overview — KPI cards (processed, processed value, avg
   time-to-acknowledge, rejection rate), trend, status & tier breakdowns, top
   tenants.
2. Tenant Explorer — pick a tenant → its processed total + a breakdown of **its
   own buyers**. This answers *"invoices processed for the customers of PwC."*
3. Operational Health — failure trend, error-code breakdown, failures by
   channel, and the Peppol interop-gap view.
4. Commercial — processed value by tier and by client group (the parent/group
   rollup); degrades gracefully if value data is absent.

**Invoices module** — searchable, filterable AR/AP invoice list with paging;
click through to an invoice detail page showing parties + the 5-corner
compliance lifecycle.

## Tenant scoping (RLS) — internal and client-facing from day one

Top-right persona switcher simulates three sign-ins:

| Persona | Sees |
|---|---|
| Suntech P&L Lead — All Clients (ADMIN) | every tenant (6,580 processed) |
| P&L Lead — Falcon Group | only the 3 Falcon tenants (group rollup) |
| Client User — PwC | only PwC (1,192 processed) |

Switch to the PwC persona and every page — analytics, invoices, even an invoice
opened by direct URL — restricts to PwC's data. This mirrors the QuickSight
dataset-layer RLS, so the same UI serves internal P&L leads now and clients
later.

> **Security boundary:** the client-side scope here is UX + defense-in-depth, not
> the security boundary. In production the real controls are (a) QuickSight RLS
> on the embedded dashboard and (b) a REST API that filters server-side by the
> authenticated principal. See `../docs/SECURITY_CHECKLIST.md`.

## Going live with QuickSight (swap preview → real dashboard)

The Analytics page is already wired for the QuickSight embed
(`src/quicksight/embed.js`). To switch from local preview to the real dashboard:

1. Deploy the QuickSight dashboard (`../docs/DEPLOY.md`).
2. Stand up a small backend endpoint that calls
   `generate-embed-url-for-registered-user`, **scoped to the signed-in
   principal** (so RLS applies server-side), and returns `{ embedUrl }`.
3. Copy `.env.example` → `.env.local`, set `VITE_QS_EMBED_ENDPOINT` to that
   endpoint, restart `npm run dev`.

The Analytics page detects the env var and renders the live embed instead of the
local charts — no code change.

## Data flow

```
../data/*.csv  ──build-data.mjs──▶  src/data/dataset.json  ──▶  React (client-side aggregation)
                                                                      │
                                  (production swap)                   ▼
        QuickSight embed  ◀──VITE_QS_EMBED_ENDPOINT──  Analytics page
```

## Notes

- `npm audit` reports advisories in **dev-only** transitive deps (esbuild via
  Vite's dev server; uuid via the QuickSight SDK). They don't affect the built
  app. Pin/upgrade on the normal dependency-maintenance cycle; don't
  `audit fix --force` (it pulls Vite 8, a breaking major).
- The JS bundle is large because the QuickSight embed SDK is heavy. Code-split
  it (dynamic import on the Analytics route) before production if bundle size
  matters.
