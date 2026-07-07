# How each user story is answered

The example questions from the request, mapped to exactly where the dashboard
answers them. Each also has a SQL form (what the QuickSight visual computes
underneath) so the answer is verifiable against the source — the Phase 5
reconciliation discipline.

The headline metric **"invoices processed" = count of FTA-acknowledged
invoices** (confirmed scope decision).

---

### "How many invoices were processed through my ASP?"

- **Where:** Executive Overview → *Invoices Processed* KPI card.
- **Underneath:** `SUM(is_processed)` over the date-range filter.
- **SQL form:**
  ```sql
  SELECT COUNT(*) AS invoices_processed
  FROM reporting.fact_invoice
  WHERE status = 'fta_acknowledged';
  -- sample data => 6580
  ```

### "How many were processed for the customers of PwC?"

"Customers of PwC" = PwC's own buyers (Corner 4). PwC is a tenant
(`TEN-PWC-AE`).

- **Where:** Tenant Explorer → set the tenant control to *PwC Middle East* →
  read the *Processed for Selected Tenant* KPI and the
  *Processed Invoices by Buyer* bar chart (one bar per PwC customer).
- **Underneath:** `SUM(is_processed)` filtered to the selected tenant, broken
  out by `buyer_name`.
- **SQL form:**
  ```sql
  SELECT b.buyer_name, COUNT(*) AS processed
  FROM reporting.fact_invoice f
  JOIN reporting.dim_tenant t ON t.tenant_key = f.tenant_key
  LEFT JOIN reporting.dim_buyer b ON b.buyer_key = f.buyer_key
  WHERE t.tenant_id = 'TEN-PWC-AE' AND f.status = 'fta_acknowledged'
  GROUP BY b.buyer_name ORDER BY processed DESC;
  -- total across PwC's buyers => 1192
  ```

### "How is volume split across our integration tiers / channels?"

- **Where:** Executive Overview → *Processed by Integration Tier*; Operational
  Health → *Failures by Channel*.
- **SQL form:**
  ```sql
  SELECT t.integration_tier, COUNT(*) FILTER (WHERE f.status='fta_acknowledged')
  FROM reporting.fact_invoice f
  JOIN reporting.dim_tenant t ON t.tenant_key=f.tenant_key
  GROUP BY t.integration_tier;
  ```

### "Which client group is driving the most processed value (AED)?"

- **Where:** Commercial / Revenue → *Processed Value by Client Group*. Uses the
  `group_account_id` rollup, so multi-entity groups (e.g. Falcon Group)
  aggregate across their tenants.
- **Note:** conditional on value data being accessible; degrades to counts
  otherwise.

### "Where are invoices failing, and is it our fault or a market-readiness gap?"

- **Where:** Operational Health → *Error Code Breakdown* + *Failures: Buyer Not
  Yet on Peppol*. The interop-gap view isolates failures caused by the buyer not
  being Peppol-registered (a market gap, not a Suntech/client error) — also a BD
  lead list (feature backlog item).
- **SQL form:**
  ```sql
  SELECT (b.is_peppol_registered) AS buyer_on_peppol, COUNT(*)
  FROM reporting.fact_invoice f
  LEFT JOIN reporting.dim_buyer b ON b.buyer_key=f.buyer_key
  WHERE f.status IN ('validation_failed','rejected')
  GROUP BY b.is_peppol_registered;
  ```

### "How fast are we clearing invoices?"

- **Where:** Executive Overview → *Avg Time-to-Acknowledge*; Operational Health
  → *Time-to-Acknowledge Distribution*.
- **Underneath:** `AVG(ttack_minutes)` (minutes from submitted → FTA ack).
