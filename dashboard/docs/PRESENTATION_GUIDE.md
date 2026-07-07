# Suntech TCA — End-to-End Explainer (Presentation & Defense Guide)

Everything in this project, explained so you can present it and answer hard
follow-up questions. Read top-to-bottom once; then use the **"Mentor will ask"**
boxes to rehearse.

All numbers below are verified against the live PostgreSQL DB:
**9,000 invoices · 18,000 transmissions · 8 tenants · 12 buyers ·
6,580 FTA-acknowledged ("processed") · PwC = 1,192 processed.**

---

## 0. The one-paragraph pitch (memorize this)

> "Suntech is an FTA-accredited Access Service Provider for UAE e-invoicing. I
> built an internal **P&L analytics + operations ERP** on top of the TCA (Tax
> Compliance Agent) platform. It models the UAE **5-corner Peppol flow**
> literally in the data, processes invoices through an **automated pipeline**
> (no manual approvals), and gives P&L leads dashboards answering questions like
> *'how many invoices did we process for the customers of PwC?'* It's a React
> front end, a Django REST backend, a PostgreSQL database, and a parallel
> AWS QuickSight analytics path — with **row-level security** so each client
> only sees their own data."

---

## 1. The domain: what problem is being solved

UAE law (FTA mandate) requires businesses to send e-invoices through an
accredited **ASP**. Suntech is that ASP. The flow is the **5-corner model**
(an extension of the standard 4-corner Peppol model):

| Corner | Who | Role |
|---|---|---|
| **C1** | Supplier (the client) | issues the invoice |
| **C2** | **Suntech ASP** | validates, transmits, reports — *this is us* |
| **C3** | Peppol Network (buyer's ASP) | AS4 secure exchange |
| **C4** | Buyer | receives the invoice |
| **C5** | UAE FTA | receives the Tax Data Document (TDD) for tax |

The key insight that drives the whole data model: from the ASP (C2), **every
invoice has two outbound legs, each with its own send + acknowledgement** —
one to the FTA (C5), one through Peppol to the buyer (C3→C4). We modeled that
literally (see §4).

**"Processed" = FTA-acknowledged** — an invoice that completed the full
compliance round-trip. This was a deliberate definition choice (could have been
"submitted" or "transmitted"); we picked the most defensible one for a
compliance/P&L view.

> **Mentor will ask: "Why is 'processed' = FTA-acknowledged and not just
> submitted?"**
> Because for a P&L/compliance audience, the meaningful unit is an invoice that
> actually cleared the tax authority. Counting submissions would inflate the
> number with invoices that later failed validation. We surface submitted and
> transmitted too, as a funnel, so nothing is hidden — but the headline KPI is
> the one that represents real compliance.

---

## 2. Architecture overview (draw this on the whiteboard)

```
              ┌─────────────────────────────────────────────┐
              │            React + Vite frontend             │  (the ERP UI)
              │  Analytics · Processing · Invoices · etc.    │
              └───────────────┬─────────────────────────────┘
                              │ REST + JSON, X-Principal header (RLS)
                              ▼
              ┌─────────────────────────────────────────────┐
              │        Django + DRF backend (API)            │
              │  models · serializers · views · rls.py       │
              └───────────────┬─────────────────────────────┘
                              │ Django ORM (psycopg 3)
                              ▼
              ┌─────────────────────────────────────────────┐
              │              PostgreSQL 18                    │
              │  public schema  : Django app tables          │
              │  reporting schema: star schema + views +     │
              │                    RLS + trigger/function    │
              └─────────────────────────────────────────────┘

   Parallel analytics path (AWS, built but not connected):
   reporting schema ──ETL──▶ QuickSight (SPICE) ──embed──▶ React Analytics page
```

Two things to stress:
1. **One source of truth, two consumers.** The same invoice data feeds both the
   live API (operations) and the QuickSight analytics path (reporting).
2. **Graceful degradation everywhere.** Backend down → frontend falls back to
   bundled sample data. AWS not connected → Analytics shows local charts. The
   app never hard-fails because a dependency is missing.

> **Mentor will ask: "Why both a Django API AND QuickSight? Isn't that
> duplication?"**
> Different jobs. The Django API powers the *operational* ERP (live invoice
> lists, the processing pipeline, drill-downs) where you need fast, scoped,
> transactional reads. QuickSight is the *managed BI* layer for P&L leads —
> SPICE in-memory aggregation, scheduled refresh, native RLS, no dashboard code
> to maintain. The project spec actually mandated QuickSight; the Django API is
> the operational complement. They read the same star schema so numbers agree.

---

## 3. The frameworks — what, why, and the trade-off you chose

### Frontend
| Framework | Why this one | What you'd say if asked "why not X?" |
|---|---|---|
| **React 18** | Component model fits a multi-module ERP; huge ecosystem | vs Angular: lighter, faster to build; vs server-rendered: we wanted a SPA talking to a JSON API |
| **Vite 5** | Instant dev server (esbuild), simple build | vs CRA: CRA is deprecated/slow; Vite HMR is sub-second |
| **React Router 6** | Client-side routing between ERP modules | — |
| **Recharts 2** | Declarative React charts, quick to compose | vs D3 directly: D3 is lower-level, more code; Recharts covers 95% of needs |
| **amazon-quicksight-embedding-sdk** | Official way to embed the QuickSight dashboard | — |

### Backend
| Framework | Why this one |
|---|---|
| **Django 5.1** | Batteries-included: ORM, migrations, admin, auth — fast to a real backend |
| **Django REST Framework** | Serializers, viewsets, pagination, browsable API — standard for Django JSON APIs |
| **django-cors-headers** | Lets the Vite dev server (:5173) call the API (:8000) cross-origin |
| **psycopg 3** | Modern PostgreSQL driver for Django |

### Data / Infra
| Tech | Why |
|---|---|
| **PostgreSQL 18** | Real relational DB: schemas, views, triggers, PL/pgSQL, RLS — production-grade |
| **Python (stdlib)** | Procedural data generation + ETL transform, zero deps for portability |
| **AWS QuickSight** | Managed BI with SPICE + native row-level security (project requirement) |
| **CloudFormation** | IaC for the refresh pipeline + security baseline |

> **Mentor will ask: "Why Django over Flask/FastAPI?"**
> Django gives the ORM, migrations, and admin for free — for a data-heavy CRUD
> app that's a big head start, and the admin let me browse the seeded data
> instantly. FastAPI would be lighter and async, but I didn't need async I/O
> here and would've had to add an ORM + migrations + admin separately. DRF's
> serializer/viewset pattern matched the resource-oriented API I wanted.

> **Mentor will ask: "React talks to Django — how, exactly?"**
> The frontend calls REST endpoints (`/api/invoices/`, `/api/analytics/summary`,
> etc.) with `fetch`, sending the current user in an `X-Principal` header. DRF
> serializers turn ORM objects into JSON. CORS headers allow the cross-origin
> call from the Vite dev origin. The frontend has an API client
> (`web/src/data/api.js`) and a store (`InvoiceStore.jsx`) that hydrates once and
> feeds every page.

---

## 4. The data model — the heart of it (this is where mentors dig)

File: `backend/invoicing/models.py`. It encodes the 5-corner diagram **literally**.

### Entities
- **`ClientGroup`** — a parent account (e.g. "Falcon Group") holding multiple
  legal entities. This is the multi-entity **rollup**.
- **`Tenant`** — one legal entity = one Suntech tenant = **Corner 1** supplier.
  Has `trn`, `integration_tier`, FK to its group.
- **`Buyer`** — **Corner 4**. Has `is_peppol_registered` (drives the interop gap).
- **`Channel`** — how the invoice was sent (the 4 integration tiers).
- **`Invoice`** — the document. `client_invoice_id` is **unique per tenant**
  (idempotency, mirrors the real platform contract). `status` is one of
  submitted / validation_failed / transmitted / fta_acknowledged / rejected.
- **`Transmission`** — **the key modeling decision.** Each invoice has up to
  **two** of these, one per outbound leg:
  - **FTA leg** (C2→C5): carries `fta_ack_reference` (the TDD).
  - **Peppol leg** (C2→C3→C4): carries `peppol_message_id`.
  Each has its own `status`, `sent_at`, `acknowledged_at`. That's why the DB has
  **18,000 transmissions for 9,000 invoices** — two legs each.
- **`RlsGrant`** — which principal may see which tenant/group (the access table).

> **Mentor will ask: "Why a separate Transmission table instead of just columns
> on Invoice?"**
> Because the diagram shows two *independent* hops, each with its own send and
> acknowledgement, that can succeed or fail independently. Flattening them into
> `fta_sent_at, fta_ack_at, peppol_sent_at, peppol_ack_at...` columns works for
> exactly two legs but doesn't model them as first-class events you can query
> ("show me all Peppol legs that failed", "average FTA ack time"). A child table
> is normalized, extensible (if a third leg appears), and makes the
> acknowledgements queryable rows — which is what the diagram actually depicts.

> **Mentor will ask: "What's `client_invoice_id` unique per tenant about?"**
> Idempotency. The real platform says resending the same id is a safe no-op. The
> unique constraint `(tenant, client_invoice_id)` enforces that two tenants can
> reuse the same id but one tenant can't double-insert — exactly the platform's
> contract.

> **Mentor will ask: "Star schema vs the Django models — why both?"**
> The Django models (`public` schema) are **normalized OLTP** — good for the
> operational app. The **star schema** (`reporting` schema: `fact_invoice` +
> `dim_*`) is **denormalized OLAP** — good for analytics/BI aggregation and what
> QuickSight ingests. Same data, two shapes for two access patterns. Classic
> OLTP/OLAP split.

---

## 5. Procedurally generated data — how and why

File: `etl/generate_sample_data.py` (pure Python stdlib, ~250 lines).

**Why generated, not real:** the real dashboard reads a read-only replica of the
live platform; we must never touch production client data. So we synthesize
realistic data to exercise every feature.

**"Procedural," not "random":** the values follow rules that make the output
*look like a real invoice population*, and a **fixed seed** (`SEED = 20260618`)
makes it **deterministic** — same 9,000 rows every run, so numbers are
reconcilable.

What's encoded:
- **8 tenants** including a real-name **PwC** (so the example story is
  answerable) and a multi-entity **Falcon Group** (to exercise group rollup +
  group RLS). All 4 integration tiers represented.
- **Weighted status mix** (verified live): 6,580 acknowledged, 1,172 rejected,
  482 transmitted, 425 validation_failed, 341 submitted. ~80% land processed,
  with a realistic failure tail.
- **Log-normal invoice values** — most small, a few large (real invoices skew
  this way), not a flat uniform spread.
- **Correlated failures** — buyers that aren't Peppol-registered are biased
  toward rejection, which makes the "interop gap" analytics meaningful.
- **~3% NULL values** on purpose — to prove the dashboard degrades to
  counts-only when value data is missing.
- **~80/20 AR/AP** split (sales vs purchase).

> **Mentor will ask: "Isn't fake data a weakness?"**
> It's a deliberate constraint, not a shortcut. Production reads a read-only
> replica — touching real client tax data for a demo would be a compliance
> violation. The generator is seeded (reproducible), rule-based (realistic
> distributions, correlated failures), and shaped exactly like the real
> `v_invoice_detail` view, so swapping in real data is a config change, not a
> rewrite. I can reconcile every dashboard number back to the generator's
> control totals.

> **Mentor will ask: "Why a fixed seed?"**
> Reproducibility. Reconciliation (Phase 5 of the plan) requires that the
> dashboard total equals a known source total. With a fixed seed the source
> total is constant (6,580 processed), so any mismatch is a real bug, not noise.

---

## 6. The TCA backend — how it works, request by request

### A request's life (e.g. PwC user loads Analytics)
1. Browser calls `GET /api/analytics/summary` with header
   `X-Principal: pnl-lead-pwc@suntech-global.com`.
2. `views.py` reads the principal, calls `rls.py:allowed_tenant_ids()`.
3. `rls.py` looks up `RlsGrant` rows for that principal → resolves to the set of
   tenant_ids (a tenant grant, or a group grant fanned out to its tenants).
4. The queryset is filtered to those tenants **in the database** — the rows
   outside scope are never fetched.
5. Django aggregates (COUNT/SUM with FILTER) in PostgreSQL and returns JSON.
6. Frontend renders charts from the JSON.

### Key backend files
- **`models.py`** — the schema (§4).
- **`serializers.py`** — flattens ORM objects into the JSON shape the frontend
  expects (matches the old `dataset.json` so the UI didn't change).
- **`views.py`** — `InvoiceViewSet` (list/detail), `TenantViewSet`, and two
  function views: `analytics_summary` (KPIs + breakdowns, computed with DB
  aggregation) and `pipeline_summary` (the automation engine, §8).
- **`rls.py`** — the security boundary (§7).
- **`pagination.py`** — configurable page size (frontend pulls 500/page to
  hydrate; the invoice table uses 50).
- **`management/commands/seed_from_csv.py`** — loads the generated CSVs into the
  models AND builds the two Transmission legs per invoice from its status.

> **Mentor will ask: "Walk me through how RLS is enforced — and prove it's not
> just hidden in the UI."**
> It's enforced server-side in the queryset (`rls.py:scope_invoices`). I can
> demo it: `curl` the API as the PwC principal and you get 1,585 rows
> (only PwC); as admin you get 9,000. Opening another tenant's invoice by URL
> returns **404**, not the data — because the object lookup is scoped first. The
> browser literally never receives out-of-scope rows. (In QuickSight the same
> thing is enforced at the dataset layer, not the visual layer.)

> **Mentor will ask: "Cross-tenant access returns 404 — why not 403?"**
> Deliberate. A 403 ("forbidden") confirms the invoice exists but you can't see
> it — that leaks information. 404 ("not found") reveals nothing about whether
> another tenant's invoice exists. Standard practice for multi-tenant isolation.

---

## 7. Security & multi-tenancy (RLS) — the part that impresses

Row-level security is the spine. Three layers:
1. **Backend queryset scoping** (`rls.py`) — the live security boundary.
2. **QuickSight dataset RLS** — for the BI path, enforced at the data layer.
3. **Frontend scoping** (`AuthContext`) — UX convenience + defense in depth,
   **explicitly not the security boundary** (documented as such).

Personas (demo): Suntech Admin (all 8 tenants), Falcon Group lead (3 Falcon
tenants — *group grant fans out*), PwC client user (1 tenant). Switching persona
rescopes every page.

> **Mentor will ask: "The frontend filters by tenant too — isn't that the
> vulnerability (client-side security)?"**
> Correct instinct, and that's why the frontend filter is **not** the boundary.
> Even if someone bypassed the UI, the API only ever returns their scoped rows
> (server-side). The client-side scope is just so the UI doesn't render empty
> controls. I documented this distinction explicitly in the security checklist.

> **Mentor will ask: "How does the demo know who the user is?"**
> Honest answer: for the demo, the principal comes from a header/persona switch —
> it's *trusted*. In production you'd derive it from an authenticated session /
> SSO / JWT and drop the header trust. I flagged this as a known demo-vs-prod gap
> in the README rather than hiding it. The RLS *logic* is real; only the identity
> source is stubbed.

Other security (from the spec, in the IaC/docs): UAE data residency
(`me-central-1`), KMS encryption at rest, TLS in transit, least-privilege ETL
roles, malware-scanned upload path (GuardDuty), private-subnet DB.

---

## 8. The automated pipeline (no manual approvals)

This replaced an earlier *manual approvals* screen — because TCA's whole value is
**automation**; a human approve/reject queue would reintroduce the labour TCA
eliminates. Files: `web/src/data/pipeline.js` (frontend) and
`views.py:pipeline_summary` (backend) — the **same logic both sides**.

The engine classifies every invoice's automated outcome:
- Maps status → how far it reached in the 5 corners (the funnel).
- **Auto-remediation:** validation failures the **Gap Analyzer** can fix from
  master data (missing TRN, tax category, mandatory fields) are auto-filled and
  auto-resubmitted → become acknowledged. Transient rejects (schema/duplicate/
  routing) are auto-retried (the platform's retry+DLQ).
- **Exceptions** (the only things surfaced): failures it *can't* auto-fix —
  buyer not on Peppol (a market gap, not our fault) or a data conflict
  (currency mismatch) needing a source fix.

Result (full dataset): ~88.9% automation rate, 73.1% straight-through, 598
auto-remediated, 999 exceptions — and it balances (acked + in-flight +
exceptions = 9,000).

> **Mentor will ask: "How do you decide what's auto-fixable vs an exception?"**
> By error code. Gap-Analyzer-fillable codes (missing/derivable fields from
> master data) are auto-remediated; a currency mismatch is a genuine data
> conflict that needs the source corrected; a buyer not on Peppol is a
> market-readiness gap we can't fix unilaterally. The rules are explicit
> constants in one place, easy to tune. I deliberately did NOT auto-"fix"
> anything that would fabricate tax data — master data is retrieved, never
> generated, because it must be verifiable for compliance.

> **Mentor will ask: "Why is the pipeline logic duplicated front and back?"**
> The backend `pipeline_summary` is the source of truth (computed in the DB,
> RLS-scoped). The frontend `pipeline.js` exists so the page still works in the
> offline/sample-data fallback and to drive the replay animation. They encode the
> same rules; if I productionized I'd have the frontend always call the backend
> and keep the JS engine only for the demo fallback.

---

## 9. PostgreSQL — the full ecosystem we used

Database `tca`, two schemas:
- **`public`** — Django app tables (`invoicing_invoice`, `invoicing_transmission`
  = 18,000 rows, etc.) + Django auth/session tables.
- **`reporting`** — the analytics star schema: `fact_invoice` + 4 dims,
  3 views (`v_invoice_detail`, `v_rls_rules`, `v_reconciliation_totals`), and a
  **PL/pgSQL trigger + function** (`fn_fact_maintain` / `trg_fact_maintain`) that
  auto-maintains `etl_loaded_at` and recomputes `ttack_minutes` on insert/update.

We used, hands-on: `CREATE DATABASE/SCHEMA/TABLE/INDEX/VIEW`, `\copy` bulk load,
`CREATE FUNCTION` (PL/pgSQL), `CREATE TRIGGER`, aggregations, `information_schema`
introspection. Django was migrated off SQLite onto this with `psycopg 3`; the DB
config reads the password from `TCA_DB_PASSWORD` (env), falls back to SQLite if
`TCA_DB_ENGINE=sqlite`.

> **Mentor will ask: "Why two schemas in one database, not two databases?"**
> They're related data with the same lifecycle and one connection; separate
> schemas give logical isolation (and separate grants) without the overhead of
> cross-database queries. The app schema is OLTP, the reporting schema is OLAP,
> but they describe the same business — one DB keeps them consistent and joinable.

> **Mentor will ask: "What does the trigger actually buy you?"**
> Data integrity that can't be bypassed by the application. Even if a row is
> inserted via raw SQL (not the app), `ttack_minutes` and `etl_loaded_at` stay
> correct because the database enforces it. It's the right layer for an invariant
> about the data itself.

> **Mentor will ask: "SQLite → Postgres — was that painful?"**
> No, because Django's ORM abstracts the DB. I changed the `DATABASES` setting,
> installed `psycopg`, ran `migrate` (Django generated the Postgres DDL from the
> same models), and re-seeded. That portability is a big reason to use the ORM
> rather than hand-written SQL for the app layer.

---

## 10. The AWS / QuickSight path (built, not connected)

Everything is coded: the star schema, the ETL transform (`etl/etl_transform.py`,
read-only source → write reporting), QuickSight asset JSON (datasource, two
datasets, RLS, a 4-page analysis), and CloudFormation (EventBridge→Step
Functions→SPICE refresh + SNS alerts; KMS/S3/GuardDuty security baseline). The
frontend Analytics page is wired to embed it, with a local-chart fallback.

It is **not connected** because there's no AWS account/credentials on this
machine — and the app says so honestly (Settings → AWS Connection panel lists
what's missing). Connecting is config-only (env vars), no code changes.

> **Mentor will ask: "You said QuickSight but it's not running — did you actually
> build it?"**
> Yes — the dataset definitions, RLS rules, the 4-page analysis, the refresh
> pipeline IaC, and a real embed-URL backend that calls
> `GenerateEmbedUrlForRegisteredUser` are all written. What's missing is *my*
> AWS account to deploy into. I built the embed-ready frontend with a fallback so
> the product is demonstrable today and becomes the live embed the moment AWS
> creds exist. I chose not to fake a connection — the UI reports the real state.

---

## 11. Data flow summary (say this to tie it together)

```
generate_sample_data.py  →  CSVs  →  seed_from_csv  →  PostgreSQL (Django models)
                                                   ↘  (also) reporting star schema
PostgreSQL  →  Django ORM  →  DRF serializers  →  JSON API  →  React store  →  pages
                                   (RLS scoping applied in the queryset)
reporting schema  →  ETL  →  QuickSight SPICE  →  embed  →  Analytics page (when AWS on)
```

---

## 12. Likely "what would you do differently / harden for prod" answers

- **Auth:** replace the trusted `X-Principal` header with real SSO/JWT; derive the
  principal server-side.
- **Pipeline:** make the frontend always call the backend; keep the JS engine
  only as the offline fallback.
- **Secrets:** the DB password is in an env var now; in prod use a secrets
  manager and a least-privilege DB role (not the `postgres` superuser).
- **Bundle size:** code-split the QuickSight SDK (it's the bulk of the JS bundle).
- **Tests:** add unit tests for `rls.py` (isolation) and `pipeline.py`
  (classification), plus an API contract test for the reconciliation totals.
- **Real data:** point the ETL at the actual read-only replica; the shapes
  already match.

---

## 13. 60-second demo script (do this live)

1. Open **http://localhost:5173** as **Admin** → Analytics shows 6,580 processed.
2. Switch persona to **PwC** → everything rescopes to 1,192; show Tenant Explorer
   → PwC's buyer breakdown ("customers of PwC").
3. **Processing** tab → hit "Replay automated run" → funnel fills, exceptions
   surface (no manual buttons — that's the point).
4. **Invoices** → open one → show the **two transmission legs** (FTA + Peppol).
5. Switch back to **Admin**, open pgAdmin → **tca** DB → show `public` (app) and
   `reporting` (star schema) schemas → run
   `SELECT status, COUNT(*) FROM invoicing_invoice GROUP BY status;` live.
6. Settings → **AWS Connection** → show the honest "not connected" status and
   explain the config-only path to go live.
