-- =============================================================================
-- Suntech P&L Invoice Analytics — QuickSight consumption views
-- =============================================================================
-- QuickSight datasets are built on these views, not directly on the fact table.
-- Rationale:
--   * Keep metric definitions (esp. "processed" = fta_acknowledged) in ONE place
--     so the dashboard and any reconciliation query agree (PROJECT_OVERVIEW.md Phase 5).
--   * Expose the RLS key columns (tenant_id, group_account_id) on every row so
--     dataset-level row-level security can filter at the DATA layer, never just
--     in the report UI (PROJECT_OVERVIEW.md "Security & Compliance").
-- =============================================================================

SET search_path TO reporting;

-- -----------------------------------------------------------------------------
-- v_invoice_detail — the wide, denormalized row QuickSight ingests into SPICE.
-- One row per invoice, all dimensions flattened, RLS keys present.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invoice_detail AS
SELECT
    f.invoice_key,
    f.client_invoice_id,

    -- RLS keys (must be present on every row).
    t.tenant_id,
    t.tenant_name,
    t.group_account_id,
    t.group_account_name,
    t.integration_tier,
    t.trn,

    b.buyer_id,
    COALESCE(b.buyer_name, 'Unknown buyer')      AS buyer_name,
    b.buyer_country,
    b.is_peppol_registered,

    c.channel_code,
    c.channel_name,

    f.direction,
    f.status,

    -- Headline metric building block: 1 when the invoice completed the full
    -- compliance round-trip (FTA-acknowledged). SUM of this = "invoices processed".
    CASE WHEN f.status = 'fta_acknowledged' THEN 1 ELSE 0 END AS is_processed,

    -- Funnel building blocks (submitted -> transmitted -> acknowledged).
    1                                                          AS is_submitted,
    CASE WHEN f.status IN ('transmitted','fta_acknowledged')
         THEN 1 ELSE 0 END                                    AS is_transmitted,
    CASE WHEN f.status IN ('validation_failed','rejected')
         THEN 1 ELSE 0 END                                    AS is_failed,

    f.value_aed,
    f.currency,
    -- Value of processed invoices only (for P&L headline value).
    CASE WHEN f.status = 'fta_acknowledged' THEN f.value_aed ELSE NULL END
                                                              AS processed_value_aed,

    f.submitted_at,
    f.transmitted_at,
    f.acknowledged_at,
    f.ttack_minutes,
    f.error_code,

    d.full_date        AS submitted_date,
    d.year_month       AS submitted_year_month,
    d.year             AS submitted_year,
    d.quarter          AS submitted_quarter,
    d.month_name       AS submitted_month_name
FROM fact_invoice f
JOIN dim_tenant  t ON t.tenant_key  = f.tenant_key
JOIN dim_channel c ON c.channel_key = f.channel_key
JOIN dim_date    d ON d.date_key    = f.submitted_date_key
LEFT JOIN dim_buyer b ON b.buyer_key = f.buyer_key;

-- -----------------------------------------------------------------------------
-- v_rls_user_tenant — the row-level security ruleset table.
-- QuickSight's RLS dataset reads this: each row grants one principal access to
-- one tenant_id (and/or a whole group_account_id). A P&L lead with group access
-- gets every tenant under that group; restricted users get only listed tenants.
--
-- Populated from the same SSO/IAM identity source used to invite QuickSight
-- users (PROJECT_OVERVIEW.md "Access"). Group-level grant = group_account_id set,
-- tenant_id NULL -> matched as "all tenants in this group" by the rule join.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rls_user_grant (
    grant_id          BIGSERIAL PRIMARY KEY,
    -- QuickSight matches on UserName (or GroupName). Store the QS principal.
    quicksight_principal VARCHAR(256) NOT NULL,
    principal_type    VARCHAR(8) NOT NULL CHECK (principal_type IN ('USER','GROUP')),
    -- Either a specific tenant grant, or a whole-group grant.
    tenant_id         VARCHAR(64),
    group_account_id  VARCHAR(64),
    CONSTRAINT chk_one_scope CHECK (
        (tenant_id IS NOT NULL AND group_account_id IS NULL) OR
        (tenant_id IS NULL     AND group_account_id IS NOT NULL)
    )
);

-- Flattened RLS view QuickSight ingests: one row per (principal, tenant_id).
-- A group grant fans out to every tenant in that group. This is the table
-- QuickSight's "row-level security" feature points at, matched on tenant_id.
CREATE OR REPLACE VIEW v_rls_rules AS
-- Specific tenant grants.
SELECT g.quicksight_principal AS "UserName",
       g.tenant_id
FROM   rls_user_grant g
WHERE  g.principal_type = 'USER'
  AND  g.tenant_id IS NOT NULL
UNION
-- Whole-group grants fanned out to member tenants.
SELECT g.quicksight_principal AS "UserName",
       t.tenant_id
FROM   rls_user_grant g
JOIN   dim_tenant t ON t.group_account_id = g.group_account_id
WHERE  g.principal_type = 'USER'
  AND  g.group_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Reconciliation helper (PROJECT_OVERVIEW.md Phase 5): dashboard totals must match
-- raw source counts. This view gives the authoritative per-tenant control totals.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_reconciliation_totals AS
SELECT
    t.tenant_id,
    t.tenant_name,
    COUNT(*)                                          AS total_invoices,
    SUM(CASE WHEN f.status='fta_acknowledged' THEN 1 ELSE 0 END) AS processed_invoices,
    SUM(CASE WHEN f.status IN ('validation_failed','rejected') THEN 1 ELSE 0 END) AS failed_invoices,
    SUM(COALESCE(f.value_aed,0))                      AS total_value_aed
FROM fact_invoice f
JOIN dim_tenant t ON t.tenant_key = f.tenant_key
GROUP BY t.tenant_id, t.tenant_name;
