#!/usr/bin/env bash
# Trigger a SPICE refresh (CreateIngestion) for both datasets. This is the same
# call the Step Functions pipeline makes after the ETL load (PROJECT_OVERVIEW.md).
set -euo pipefail
: "${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID}"
: "${QS_REGION:=me-central-1}"

stamp="$(date +%Y%m%d%H%M%S)"
for ds in suntech-pnl-rls-rules suntech-pnl-invoice-detail; do
  echo ">> Ingesting $ds"
  aws quicksight create-ingestion --region "$QS_REGION" \
    --aws-account-id "$AWS_ACCOUNT_ID" \
    --data-set-id "$ds" \
    --ingestion-id "ingest-$stamp"
done
echo ">> Ingestions started. Poll with: aws quicksight describe-ingestion ..."
