# Security & Compliance Checklist

Implements the project-specific requirements in `PROJECT_OVERVIEW.md` → *"Security &
Compliance Requirements (this project specifically)"*, plus the inherited
"Suntech always owns" obligations. Use this as the go-live gate (Phase 5).

> Principle: this is a separate codebase, but it touches the **same regulated
> client data** as the core platform, so the bar is **not** lowered.

## Row-level security (the headline requirement)

- [ ] RLS is enforced at the **dataset/data layer**, never only hidden in the
      report UI. → `quicksight/01_dataset_invoice_detail.json`
      `RowLevelPermissionDataSet` points at the RLS dataset.
- [ ] RLS rules come from `reporting.v_rls_rules`, which fans **group-level**
      grants out to member tenants (a P&L lead for a group sees all its tenants;
      a restricted user sees only listed tenants).
- [ ] **Negative test:** log in as a restricted user (e.g. `pnl-lead-pwc`) and
      confirm you can see *only* `TEN-PWC-AE`; attempt to reach another tenant's
      rows via every visual and via the Tenant Explorer parameter — must return
      nothing.
- [ ] Admin / "see everything" principals are handled deliberately: with the
      `GRANT_ACCESS` policy, a principal **absent** from the rules table sees
      **no** rows. Admins must therefore either be added to the rules table with
      all tenant_ids, **or** use a separate non-RLS admin dataset. Decide and
      document which. *(Default recommendation: explicit admin grants, so there
      is no un-RLS'd copy of the data.)*

## Authentication & access

- [ ] Authentication rides on existing **SSO / IAM Identity Center**.
- [ ] **MFA mandatory** for authoring/admin roles (QuickSight admin + AWS
      console). Readers via SSO inherit the IdP's MFA policy.
- [ ] QuickSight users invited natively; no shared accounts.

## ETL least-privilege

- [ ] Source DB role is **read-only** on the source replica; ETL also sets
      `default_transaction_read_only = on` as defense in depth.
      → `etl_transform.py`
- [ ] Reporting DB role is **write-only** on the reporting schema (DDL applied by
      a separate migration role, not the ETL role).
- [ ] ETL task IAM role can read **only** the two named secrets — nothing else.
      → `iac/refresh_pipeline.yaml` `EtlTaskRole`.
- [ ] Reporting DB is in a **private subnet, no public endpoint**; ETL runs in
      private subnets with `AssignPublicIp: DISABLED`.

## Secrets & encryption

- [ ] All DB credentials in **Secrets Manager**; none in code or env files.
- [ ] **KMS** envelope encryption at rest on all buckets + (in production) on the
      RDS instance and SPICE. → `iac/upload_scan_baseline.yaml` `DataKey`,
      key rotation enabled.
- [ ] **TLS 1.2+** in transit on every hop: `sslmode=require` (ETL),
      `SslProperties.DisableSsl=false` (QuickSight data source).

## Upload-path hardening

- [ ] Any Excel/CSV upload lands in the **landing bucket** and is **malware
      scanned** by GuardDuty Malware Protection for S3 before parsing.
      → `iac/upload_scan_baseline.yaml` `MalwareProtectionPlan`.
- [ ] **Macros stripped** before the spreadsheet is parsed (the post-scan
      copy-to-clean Lambda must re-serialize to a macro-free format; wire this in
      before enabling any upload feed).
- [ ] `THREATS_FOUND` → object quarantined + **SNS alert**.
      → `MalwareFindingRule`.
- [ ] Buckets: public access fully blocked, versioned, **access-logged**.

## Dependencies

- [ ] Python deps **version-pinned** (`etl/requirements.txt`) and
      vulnerability-scanned (e.g. `pip-audit` in CI) before the ETL image is
      built/pushed.
- [ ] Container image scanned on push (ECR scan-on-push).

## Monitoring & audit

- [ ] **Access logging** on the dashboard/data layer; alert on any
      **cross-tenant query attempt** (CloudTrail + QuickSight access events →
      detection rule).
- [ ] Refresh pipeline failures → **SNS → Slack + email** with the real failure
      cause. → `iac/refresh_pipeline.yaml` `NotifyFailure` includes `$.Cause`.
- [ ] CloudWatch log retention set (90 days on the ETL log group).

## Data residency

- [ ] QuickSight home region **and** all data stores in **`me-central-1`
      (UAE/Dubai)**. No data leaves the UAE region.

## Reconciliation (Phase 5, correctness gate)

- [ ] Dashboard totals match raw source counts. Compare the Executive KPI and
      Tenant Explorer numbers against `reporting.v_reconciliation_totals` (and,
      for the sample data, against the generator's printed control totals).
