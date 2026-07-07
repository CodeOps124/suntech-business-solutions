# Prerequisites — mapped to the spec

The request was explicit: *"strictly follow the prerequisites and the .md
instructions, since this is for a company."* This file maps every relevant
prerequisite from `PROJECT_OVERVIEW.md` and the Integration Methods Guide
to how this project satisfies (or defers) it.

There are two prerequisite layers:

1. **Project infrastructure prerequisites** — what must exist to deploy *this
   dashboard*.
2. **Common client prerequisites** — the platform-level prerequisites from the
   Integration Methods Guide. This dashboard is internal and does not onboard
   clients, but it *depends on* clients having met these (that's what produces
   clean source data), so they're tracked here for traceability.

---

## 1. Project infrastructure prerequisites (must exist before deploy)

| # | Prerequisite | Why | Where enforced |
|---|---|---|---|
| P1 | **QuickSight Enterprise** in `me-central-1` (Dubai) | RLS requires Enterprise; Dubai region satisfies data residency without workaround (region GA Aug 2025) | `docs/DEPLOY.md`, all QS asset ARNs pinned to `me-central-1` |
| P2 | **Read-only replica** of the TCA data store, in a **private subnet** | Spec: never touch primary prod DB; no public endpoint | `iac/refresh_pipeline.yaml` (private subnets, SG egress only); ETL `SET default_transaction_read_only` |
| P3 | **Reporting database** (Postgres) with the `reporting` schema applied | Target for the ETL star schema | `sql/01_*`, `sql/02_*` |
| P4 | **Secrets Manager** secrets: source-reader (read-only) + reporting-writer | No hard-coded credentials; TLS in transit | `iac/refresh_pipeline.yaml` SourceSecret/TargetSecret; `etl_transform.py` `_get_secret` |
| P5 | **QuickSight VPC connection** to reach the private reporting DB | QuickSight must read the replica privately | `quicksight/00_datasource_postgres.json` `VpcConnectionProperties` |
| P6 | **SSO / IAM Identity Center** users for P&L leads | Access rides on existing SSO; native QS user invites | `docs/DEPLOY.md` step "invite users"; RLS keyed on QS principal |
| P7 | **ECR image** for the ETL container | Step Functions runs it as a Fargate task | `iac/refresh_pipeline.yaml` `EtlImageUri` param |
| P8 | **SNS alert email/Slack** target | Failure alerting on the refresh pipeline | `iac/refresh_pipeline.yaml` AlertTopic |

## 2. Common client prerequisites (Integration Methods Guide, Part 3)

These are the *client's* obligations on the platform. The dashboard does not
collect them, but its numbers are only meaningful when they hold. Tracked for
auditability.

| Prerequisite (guide) | Relevance to this dashboard |
|---|---|
| Valid UAE **TRN** | Carried on `dim_tenant.trn`; lets P&L leads tie volume to a legal entity |
| Active e-invoicing obligation / voluntary registration | Determines which tenants legitimately appear |
| Signed MSA + DPA | Governs that we may process this client's invoice data in the replica at all |
| Named business owner + technical contact | Out of dashboard scope (commercial), noted for completeness |
| Clean **customer/supplier master data** | Drives `dim_buyer` quality; bad master data shows up as `Unknown buyer` |
| Items mapped to UAE tax categories | Upstream; affects status/validation outcomes we report |
| **Peppol Participant ID** registration | Buyers without it surface in the **interop-gap** view (Operational Health) |
| Data residency acknowledgement (AWS UAE) | Honored: QuickSight + all data in `me-central-1` |

## 3. Cross-cutting technical contracts honored

From `PROJECT_OVERVIEW.md` "Cross-Cutting Technical Contracts" — the ones this project
must respect because it reads the same data:

- **Idempotency (C3):** the ETL UPSERTs on `(tenant_key, client_invoice_id)`,
  mirroring the platform's `client_invoice_id` idempotency. Re-running the ETL is
  a safe no-op for unchanged rows.
- **Multi-tenant model (C5):** each legal entity = one tenant; groups roll up via
  `dim_tenant.group_account_id`. RLS can grant a P&L lead a whole group or a
  single tenant.
- **Data residency / encryption (C8):** `me-central-1`, KMS envelope encryption
  at rest (`iac/upload_scan_baseline.yaml`), TLS 1.2+ in transit (`sslmode=require`,
  `DisableSsl:false`).

## 4. Explicit non-goals respected

From `PROJECT_OVERVIEW.md` — things this project deliberately does **not** do:

- Does **not** re-sort/assign invoice status (reads platform-assigned status).
- Does **not** build a custom embedding app (native QS invites for now; embed is
  Phase 7).
- Does **not** create per-client custom schemas (one canonical model).
- Commercial/revenue page is **conditional** — not assumed live until value data
  access is confirmed.
