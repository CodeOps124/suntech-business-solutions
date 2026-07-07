#!/usr/bin/env bash
# =============================================================================
# Deploy the QuickSight assets for the Suntech P&L Invoice Analytics dashboard.
# Order: data source -> RLS dataset -> main dataset -> analysis -> dashboard.
#
# Prerequisites (see docs/DEPLOY.md and docs/PREREQUISITES.md):
#   * aws CLI v2 configured for the target account, region me-central-1 (Dubai).
#   * QuickSight Enterprise edition enabled in me-central-1 (RLS needs Enterprise).
#   * VPC connection + Secrets Manager secret already provisioned by the IaC.
#   * jq installed.
#
# Usage:
#   AWS_ACCOUNT_ID=123456789012 QS_REGION=me-central-1 \
#   QS_ADMIN_ARN=arn:aws:quicksight:me-central-1:123456789012:user/default/admin \
#   ./deploy_quicksight.sh
# =============================================================================
set -euo pipefail

: "${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID}"
: "${QS_REGION:=me-central-1}"
: "${QS_ADMIN_ARN:?set QS_ADMIN_ARN (QuickSight principal to own the assets)}"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
QS_DIR="$HERE/quicksight"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Substitute the account id into every asset file before applying.
render() { sed "s/REPLACE_WITH_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" "$1" | grep -v '"_comment"' ; }

echo ">> [1/5] Data source: Postgres reporting replica"
render "$QS_DIR/00_datasource_postgres.json" > "$TMP/ds.json"
aws quicksight create-data-source --region "$QS_REGION" --cli-input-json "file://$TMP/ds.json" \
  || echo "   (data source may already exist; continuing)"

echo ">> [2/5] RLS rules dataset"
render "$QS_DIR/02_dataset_rls.json" > "$TMP/rls.json"
aws quicksight create-data-set --region "$QS_REGION" --cli-input-json "file://$TMP/rls.json" \
  --permissions "Principal=$QS_ADMIN_ARN,Actions=quicksight:DescribeDataSet,quicksight:UpdateDataSet,quicksight:DeleteDataSet,quicksight:PassDataSet,quicksight:DescribeDataSetPermissions,quicksight:UpdateDataSetPermissions" \
  || echo "   (RLS dataset may already exist; continuing)"

echo ">> [3/5] Main dataset (invoice detail, SPICE, RLS-protected)"
render "$QS_DIR/01_dataset_invoice_detail.json" > "$TMP/main.json"
aws quicksight create-data-set --region "$QS_REGION" --cli-input-json "file://$TMP/main.json" \
  --permissions "Principal=$QS_ADMIN_ARN,Actions=quicksight:DescribeDataSet,quicksight:UpdateDataSet,quicksight:DeleteDataSet,quicksight:PassDataSet,quicksight:DescribeDataSetPermissions,quicksight:UpdateDataSetPermissions" \
  || echo "   (main dataset may already exist; continuing)"

echo ">> [4/5] Analysis (4 pages)"
render "$QS_DIR/03_analysis_definition.json" > "$TMP/analysis.json"
aws quicksight create-analysis --region "$QS_REGION" \
  --aws-account-id "$AWS_ACCOUNT_ID" \
  --analysis-id "suntech-pnl-invoice-analytics" \
  --name "Suntech P&L - Invoice Analytics" \
  --definition "$(jq '.Definition' "$TMP/analysis.json")" \
  --permissions "Principal=$QS_ADMIN_ARN,Actions=quicksight:RestoreAnalysis,quicksight:UpdateAnalysisPermissions,quicksight:DeleteAnalysis,quicksight:DescribeAnalysisPermissions,quicksight:QueryAnalysis,quicksight:DescribeAnalysis,quicksight:UpdateAnalysis" \
  || echo "   (analysis may already exist; use update-analysis to refresh)"

echo ">> [5/5] Publish dashboard from the analysis"
aws quicksight create-dashboard --region "$QS_REGION" \
  --aws-account-id "$AWS_ACCOUNT_ID" \
  --dashboard-id "suntech-pnl-invoice-analytics" \
  --name "Suntech P&L - Invoice Analytics" \
  --definition "$(jq '.Definition' "$TMP/analysis.json")" \
  --permissions "Principal=$QS_ADMIN_ARN,Actions=quicksight:DescribeDashboard,quicksight:ListDashboardVersions,quicksight:UpdateDashboardPermissions,quicksight:QueryDashboard,quicksight:UpdateDashboard,quicksight:DeleteDashboard,quicksight:DescribeDashboardPermissions,quicksight:UpdateDashboardPublishedVersion" \
  || echo "   (dashboard may already exist; use update-dashboard to refresh)"

echo ">> Done. Trigger the first SPICE ingestion with scripts/refresh_spice.sh"
