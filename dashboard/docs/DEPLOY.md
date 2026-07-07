# Deploy Guide

End-to-end deployment of the P&L Invoice Analytics dashboard. Follows the
project roadmap phases in `PROJECT_OVERVIEW.md` (Phase 1 → 5).

> **Region is non-negotiable: `me-central-1` (UAE / Dubai)** for data residency.
> Set it on every command (`--region me-central-1`) and as the QuickSight home
> region. Do this once, before anything else.

## 0. Prerequisites

Confirm everything in [`PREREQUISITES.md`](PREREQUISITES.md) §1 exists. You need
admin AWS access in the target account and `aws` CLI v2, `jq`, `python3`.

## Phase 1 — Data model + ETL

1. Create the reporting Postgres (private subnet, KMS-encrypted, TLS on).
2. Apply the schema and views:
   ```bash
   psql "$REPORTING_URL" -f sql/01_reporting_schema.sql
   psql "$REPORTING_URL" -f sql/02_quicksight_views.sql
   ```
3. Seed the dimension tables (`dim_*`) from master data. For a demo, use the
   generated CSVs:
   ```bash
   python etl/generate_sample_data.py
   psql "$REPORTING_URL" -f sql/03_load_sample_data.sql
   ```
4. Build + push the ETL image to ECR (it runs `etl_transform.py`). Pin deps via
   `etl/requirements.txt`; scan before push.

## Phase 2 — Infra (refresh pipeline + security baseline)

```bash
# Security baseline (KMS, buckets, GuardDuty malware scan). Reuse its SNS topic.
aws cloudformation deploy --region me-central-1 \
  --template-file iac/upload_scan_baseline.yaml \
  --stack-name suntech-pnl-security \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides SecurityAlertTopicArn=PLACEHOLDER_OR_PREEXISTING

# Refresh pipeline (EventBridge -> Step Functions -> SPICE -> SNS).
SUBNETS_JSON=$(scripts/render_subnets.sh subnet-aaa subnet-bbb)
aws cloudformation deploy --region me-central-1 \
  --template-file iac/refresh_pipeline.yaml \
  --stack-name suntech-pnl-refresh \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    QuickSightAccountId=$AWS_ACCOUNT_ID \
    EtlImageUri=$ECR_IMAGE_URI \
    AlertEmail=pnl-alerts@suntech-global.com \
    PrivateSubnetIdsJson="$SUBNETS_JSON" \
    VpcId=vpc-xxxx
```

Populate the two Secrets Manager secrets (`suntech-pnl/source-replica-reader`,
`suntech-pnl/reporting-writer`) with the DB credentials.

## Phase 2 (cont.) — QuickSight account + assets

1. Enable QuickSight **Enterprise** with home region `me-central-1`. Create the
   **VPC connection** to the reporting DB.
2. Deploy the assets (data source → RLS dataset → main dataset → analysis →
   dashboard):
   ```bash
   export AWS_ACCOUNT_ID=123456789012
   export QS_REGION=me-central-1
   export QS_ADMIN_ARN=arn:aws:quicksight:me-central-1:123456789012:user/default/<admin>
   scripts/deploy_quicksight.sh
   ```
3. First SPICE ingestion:
   ```bash
   scripts/refresh_spice.sh
   ```

## Phase 3 — Pages

The four pages are already defined in
`quicksight/03_analysis_definition.json`. Open the analysis in QuickSight to
fine-tune layout/theme. If value (AED) data is **not** accessible, hide the
**Commercial / Revenue** sheet (it is conditional by design).

## Phase 4 — Automation + hardening

The daily refresh (EventBridge Scheduler, `cron(0 2 * * ? *)` Dubai time),
failure alerting, least-privilege IAM, private networking, KMS, and malware
scanning are all deployed by the two CloudFormation stacks above. Walk
[`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) and tick every box.

## Phase 5 — Validate + roll out

1. **Reconcile** dashboard totals against source counts:
   ```sql
   SELECT * FROM reporting.v_reconciliation_totals ORDER BY total_invoices DESC;
   ```
   For the sample data these must equal the generator's control totals
   (`9000 / 6580 / PwC 1192`).
2. **RLS negative test** — see `SECURITY_CHECKLIST.md` (log in as a restricted
   user, attempt cross-tenant access, confirm it's blocked at the data layer).
3. Invite P&L leads as QuickSight readers (tie to SSO). Insert their grants into
   `reporting.rls_user_grant` (per-tenant or per-group), then re-run
   `scripts/refresh_spice.sh` so the RLS dataset picks them up.
4. Get sign-off.

## Updating later

- Change a visual/metric: edit `quicksight/03_analysis_definition.json`, then
  `aws quicksight update-analysis` + `update-dashboard` (same `--definition`).
- Change a metric definition (e.g. what counts as "processed"): change it in
  `sql/02_quicksight_views.sql` **once** — both the dashboard and the
  reconciliation view read from there.

## Phase 7 (future, optional) — Portal embedding

Only if/when this is folded into the client-facing Web Portal: build an
embed-auth service using `generate_embed_url_for_registered_user` and the
`amazon-quicksight-embedding-sdk` v2 (`createEmbeddingContext` / `embedDashboard`).
Not in scope now.
