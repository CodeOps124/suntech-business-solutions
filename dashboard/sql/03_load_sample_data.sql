-- =============================================================================
-- Load generated sample CSVs into the reporting star schema (local dev / demo).
-- Run AFTER 01_reporting_schema.sql and 02_quicksight_views.sql.
-- Adjust the file paths to your checkout location, or use \copy from psql.
-- =============================================================================
SET search_path TO reporting;

-- Order matters: dims before fact (FK), grants any time.
\copy dim_date       FROM '../data/dim_date.csv'       WITH (FORMAT csv, HEADER true);
\copy dim_tenant     FROM '../data/dim_tenant.csv'     WITH (FORMAT csv, HEADER true);
\copy dim_buyer      FROM '../data/dim_buyer.csv'      WITH (FORMAT csv, HEADER true);
\copy dim_channel    FROM '../data/dim_channel.csv'    WITH (FORMAT csv, HEADER true);
-- Explicit column list: the CSV omits etl_loaded_at (it uses its DEFAULT now()).
\copy fact_invoice (invoice_key, client_invoice_id, tenant_key, buyer_key, channel_key, direction, status, value_aed, currency, submitted_at, transmitted_at, acknowledged_at, submitted_date_key, ttack_minutes, error_code) FROM '../data/fact_invoice.csv' WITH (FORMAT csv, HEADER true, NULL '');
\copy rls_user_grant FROM '../data/rls_user_grant.csv' WITH (FORMAT csv, HEADER true, NULL '');

-- Reset sequences so future inserts don't collide with the loaded surrogate keys.
SELECT setval(pg_get_serial_sequence('dim_tenant','tenant_key'),   (SELECT MAX(tenant_key)   FROM dim_tenant));
SELECT setval(pg_get_serial_sequence('dim_buyer','buyer_key'),     (SELECT MAX(buyer_key)    FROM dim_buyer));
SELECT setval(pg_get_serial_sequence('dim_channel','channel_key'), (SELECT MAX(channel_key)  FROM dim_channel));
SELECT setval(pg_get_serial_sequence('fact_invoice','invoice_key'),(SELECT MAX(invoice_key)  FROM fact_invoice));
SELECT setval(pg_get_serial_sequence('rls_user_grant','grant_id'), (SELECT MAX(grant_id)     FROM rls_user_grant));

-- Sanity / reconciliation check (compare to generator control totals).
SELECT 'total_invoices'  AS metric, COUNT(*)::text AS value FROM fact_invoice
UNION ALL
SELECT 'processed_fta_ack', COUNT(*)::text FROM fact_invoice WHERE status='fta_acknowledged'
UNION ALL
SELECT 'pwc_processed', COUNT(*)::text
  FROM fact_invoice f JOIN dim_tenant t ON t.tenant_key=f.tenant_key
 WHERE t.tenant_id='TEN-PWC-AE' AND f.status='fta_acknowledged';
