-- =============================================================================
-- Suntech P&L Invoice Analytics — Reporting Star Schema (PostgreSQL dialect)
-- =============================================================================
-- Per PROJECT_OVERVIEW.md "Data Model (star schema)" and "Architecture & Automation":
--   * This schema lives in the *reporting* database, populated by the ETL job.
--   * The ETL reads from a READ-ONLY replica of TCA's data store and writes
--     ONLY here. It never touches the primary production database.
--   * grain of fact_invoice = one row per invoice (per client_invoice_id+tenant).
--
-- Security note (PROJECT_OVERVIEW.md "Security & Compliance"):
--   The ETL role is least-privilege: read-only on the source replica,
--   write-only on THIS reporting schema. This DDL is applied by a migration
--   role, not by the ETL role.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS reporting;
SET search_path TO reporting;

-- -----------------------------------------------------------------------------
-- dim_date — standard calendar dimension
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_date (
    date_key        INTEGER PRIMARY KEY,          -- yyyymmdd
    full_date       DATE        NOT NULL,
    day_of_month    SMALLINT    NOT NULL,
    month_num       SMALLINT    NOT NULL,
    month_name      VARCHAR(12) NOT NULL,
    quarter         SMALLINT    NOT NULL,
    year            SMALLINT    NOT NULL,
    year_month      CHAR(7)     NOT NULL,          -- 'YYYY-MM'
    is_weekend      BOOLEAN     NOT NULL
);

-- -----------------------------------------------------------------------------
-- dim_tenant — one row per legal entity (= one Suntech tenant).
-- Includes the parent/group rollup level: multi-entity clients are a real
-- segment (PROJECT_OVERVIEW.md C5 Multi-tenant + "Verified Public Facts" group track).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_tenant (
    tenant_key          BIGSERIAL PRIMARY KEY,
    tenant_id           VARCHAR(64)  NOT NULL UNIQUE,   -- natural key from TCA
    tenant_name         VARCHAR(256) NOT NULL,
    trn                 VARCHAR(20),                     -- UAE Tax Registration Number
    -- Group rollup: the parent client account a tenant belongs to.
    group_account_id    VARCHAR(64)  NOT NULL,
    group_account_name  VARCHAR(256) NOT NULL,
    -- Integration tier this tenant onboarded with.
    integration_tier    VARCHAR(32)  NOT NULL
        CHECK (integration_tier IN ('Embedded','Managed','Connect','Portal')),
    onboarded_date      DATE,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- dim_buyer — the receiving party (Corner 4). Drives the "customers of X"
-- breakdown: X's own buyers (per scope decision).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_buyer (
    buyer_key           BIGSERIAL PRIMARY KEY,
    buyer_id            VARCHAR(64)  NOT NULL UNIQUE,    -- Peppol participant / natural key
    buyer_name          VARCHAR(256) NOT NULL,
    buyer_country       CHAR(2),                          -- ISO-3166 alpha-2
    -- Peppol readiness: NULL/false = buyer not yet on the network (interop gap).
    is_peppol_registered BOOLEAN     NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- dim_channel — send channel (PROJECT_OVERVIEW.md "Send Channels" table).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_channel (
    channel_key     SMALLSERIAL PRIMARY KEY,
    channel_code    VARCHAR(32) NOT NULL UNIQUE,
    channel_name    VARCHAR(64) NOT NULL,
    integration_tier VARCHAR(32) NOT NULL
);

-- -----------------------------------------------------------------------------
-- fact_invoice — grain: one invoice.
-- status values mirror the SFTP per-invoice outcomes in PROJECT_OVERVIEW.md
-- ("accepted / validation-failed / transmitted / FTA-acknowledged / rejected").
-- The headline "processed" KPI = status = 'fta_acknowledged' (scope decision).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_invoice (
    invoice_key             BIGSERIAL PRIMARY KEY,
    -- Idempotency key from TCA: unique per tenant (PROJECT_OVERVIEW.md C3).
    client_invoice_id       VARCHAR(128) NOT NULL,
    tenant_key              BIGINT       NOT NULL REFERENCES dim_tenant(tenant_key),
    buyer_key               BIGINT       REFERENCES dim_buyer(buyer_key),
    channel_key             SMALLINT     NOT NULL REFERENCES dim_channel(channel_key),

    direction               VARCHAR(2)   NOT NULL CHECK (direction IN ('AR','AP')),

    -- Lifecycle status as already assigned by the live TCA Platform.
    -- This project READS status; it does NOT sort/assign it (PROJECT_OVERVIEW.md note).
    status                  VARCHAR(24)  NOT NULL
        CHECK (status IN ('submitted','validation_failed','transmitted',
                          'fta_acknowledged','rejected')),

    -- Value (AED). Nullable so visuals degrade gracefully to counts-only
    -- if billing/value data is not accessible (scope decision).
    value_aed               NUMERIC(18,2),
    currency                CHAR(3),

    -- Lifecycle timestamps for funnel + time-to-acknowledge.
    submitted_at            TIMESTAMPTZ  NOT NULL,
    transmitted_at          TIMESTAMPTZ,
    acknowledged_at         TIMESTAMPTZ,
    submitted_date_key      INTEGER      NOT NULL REFERENCES dim_date(date_key),

    -- Pre-computed time-to-acknowledge in minutes (NULL until acknowledged).
    ttack_minutes           INTEGER,

    -- Permanent-error code surfaced by the platform (NULL if none).
    error_code              VARCHAR(32),

    etl_loaded_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_invoice_per_tenant UNIQUE (tenant_key, client_invoice_id)
);

-- Indexes tuned for the dashboard's filter/aggregate patterns.
CREATE INDEX IF NOT EXISTS ix_fact_tenant      ON fact_invoice(tenant_key);
CREATE INDEX IF NOT EXISTS ix_fact_buyer       ON fact_invoice(buyer_key);
CREATE INDEX IF NOT EXISTS ix_fact_status      ON fact_invoice(status);
CREATE INDEX IF NOT EXISTS ix_fact_date        ON fact_invoice(submitted_date_key);
CREATE INDEX IF NOT EXISTS ix_fact_direction   ON fact_invoice(direction);
