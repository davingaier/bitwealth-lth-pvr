# BitWealth LTH PVR - AI Agent Instructions

## Project Overview

**BitWealth LTH PVR** is a Bitcoin Dollar-Cost Averaging (DCA) service using the **Long-Term Holder Price Variance Ratio (LTH PVR)** strategy. The system automates daily BTC buy/sell decisions, executes orders via VALR exchange, tracks performance, and compares results against standard DCA benchmarks.

- **Stack:** Supabase PostgreSQL + Deno Edge Functions + vanilla HTML/JS admin UI
- **Exchange:** VALR (South African crypto exchange) with HMAC authentication and subaccount routing
- **Architecture:** Event-driven daily pipeline orchestrated via `pg_cron`, with automated alerting and recovery mechanisms

## Critical Architectural Patterns

### 1. Daily Pipeline Execution (03:00-17:00 UTC)

The system runs a **6-step sequential pipeline** every trading day:

1. **CI Bands Fetch** (`ef_fetch_ci_bands`) - 03:00 UTC
   - Fetches on-chain LTH PVR bands from CryptoQuant API
   - Stored in `lth_pvr.ci_bands_daily`
   - **Guard mechanism:** `lth_pvr.ensure_ci_bands_today()` runs every 30 min to retry if missing

2. **Generate Decisions** (`ef_generate_decisions`) - 03:05 UTC
   - Compares BTC price to CI bands to determine buy/sell/hold
   - Applies momentum filters and retrace logic
   - Creates records in `lth_pvr.decisions_daily`

3. **Create Order Intents** (`ef_create_order_intents`) - 03:10 UTC
   - Sizes orders based on decisions and available capital
   - Writes to `lth_pvr.order_intents`

4. **Execute Orders** (`ef_execute_orders`) - 03:15 UTC
   - Places LIMIT orders on VALR via REST API
   - Initiates WebSocket monitoring for real-time updates
   - Creates `lth_pvr.exchange_orders` records

5. **Poll Orders** (`ef_poll_orders`) - Every 10 minutes
   - Safety net for order status updates (WebSocket is primary)
   - Implements 5-minute fallback: cancels stale LIMITs, places MARKET orders
   - Records fills in `lth_pvr.order_fills`

6. **Post Ledger & Balances** (`ef_post_ledger_and_balances`) - After fills complete
   - Rolls up fills into `lth_pvr.ledger_lines`
   - Calculates NAV in `lth_pvr.balances_daily`

**Pipeline Resume System:**
- If step 1 fails (CI bands unavailable), entire pipeline halts
- `lth_pvr.get_pipeline_status()` - Checks completion state of all 6 steps
- `ef_resume_pipeline` - Sequential orchestrator that resumes from incomplete steps
- UI: Administration module → Pipeline Control Panel with status checkboxes and Resume button
- **Key Fix (2025-12-28):** Sequential execution via `await fetch()` replaced async `pg_net` queuing to prevent race conditions

### 2. Supabase Schema Organization

**Three schemas with distinct purposes:**

- **`public`** - Shared multi-tenant entities
  - `customer_details`, `customer_portfolios`, `organizations`, `org_members`
  - `exchange_accounts` - Single source of truth for VALR credentials/subaccounts
  - `strategies` - Catalog of strategy types (LTH_PVR, ADV_DCA, etc.)

- **`lth_pvr`** - Live trading operations
  - Decision tables: `ci_bands_daily`, `decisions_daily`, `order_intents`
  - Exchange integration: `exchange_orders`, `order_fills`
  - Accounting: `ledger_lines`, `balances_daily`, `customer_state_daily`
  - Monitoring: `alert_events`, `ci_bands_guard_log`
  - Benchmark: `std_dca_balances_daily`, `std_dca_ledger`

- **`lth_pvr_bt`** - Back-testing (isolated from live data)
  - `bt_runs`, `bt_results_daily`, `bt_std_dca_balances`

### 3. VALR Exchange Integration

**Authentication Pattern:**
```typescript
// All VALR requests require HMAC SHA-512 signing
const timestamp = Date.now().toString();
const signature = await signVALR(timestamp, method, path, body, apiSecret);

headers: {
  "X-VALR-API-KEY": apiKey,
  "X-VALR-SIGNATURE": signature,
  "X-VALR-TIMESTAMP": timestamp,
  "X-VALR-SUB-ACCOUNT-ID": subaccountId  // Per-customer routing
}
```

**Subaccount Routing:**
- Single primary VALR API key/secret in environment variables
- Each customer has a dedicated VALR subaccount
- `public.exchange_accounts.subaccount_id` maps customers to subaccounts
- Order placement includes `X-VALR-SUB-ACCOUNT-ID` header for isolation

**Order Execution Pattern:**
- LIMIT orders preferred (better price, post-only available)
- 5-minute timeout: Cancel stale LIMIT, replace with MARKET order
- Use `customerOrderId` = `intent_id` for tracking (enables idempotent polling)

### 4. Alerting & Monitoring

**Centralized Alert System:**
```typescript
// Shared module: supabase/functions/_shared/alerting.ts
import { logAlert } from "../_shared/alerting.ts";

// Usage in edge functions:
await logAlert(
  sb,
  "ef_execute_orders",         // component name
  "error",                      // severity: info|warn|error|critical
  "No exchange account",        // human-readable message
  { customer_id, intent_id },   // structured context
  org_id,
  customer_id
);
```

**Alert Digest Email:**
- `ef_alert_digest` runs daily at 05:00 UTC via `pg_cron`
- Queries unnotified error/critical alerts from `lth_pvr.alert_events`
- Sends email via Resend API, updates `notified_at` timestamp
- **UI:** Administration module displays alert badge with count, filterable by component

**WebSocket Monitoring:**
- `ef_valr_ws_monitor` - Real-time order updates from VALR WebSocket API
- Reduces polling from 1,440/day to ~170/day (98% reduction)
- Hybrid approach: WebSocket primary, 10-minute polling as safety net

## Deployment Workflow

### Deploying Edge Functions

**Standard deployment:**
```powershell
# Single function
supabase functions deploy ef_execute_orders --project-ref wqnmxpooabmedvtackji

# All functions (batch script)
.\redeploy-all-functions.ps1
```

**JWT Verification Rules:**
- **Disable** (`--no-verify-jwt`) for: Internal pipeline functions, cron-triggered functions, service-to-service calls
- **Enable** (default) for: Public-facing APIs, authenticated user requests

**Environment Variables Required:**
- `SUPABASE_URL` / `SB_URL` - Project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (NOT "Secret Key" - old legacy name)
- `ORG_ID` - Organization UUID for multi-tenancy
- `VALR_API_KEY`, `VALR_API_SECRET` - Exchange credentials
- `RESEND_API_KEY` - Email provider for alerts

### Applying Migrations

**Migration locations:**
- `supabase/migrations/` - Tracked migrations (applied via `supabase db push`)
- `supabase/sql/migrations/` - Scratch area for development

**Manual migration via MCP:**
```typescript
await mcp_supabase_apply_migration({
  name: "add_pipeline_resume_cron",
  query: "-- SQL content here"
});
```

**Migration naming:** `YYYYMMDD_descriptive_name.sql` (e.g., `20251230_add_resume_pipeline_cron.sql`)

## Code Conventions

### Edge Function Structure

**Standard pattern for pipeline functions:**
```typescript
// 1. Imports
import { getServiceClient } from "./client.ts";
import { logAlert } from "./alerting.ts";

// 2. Initialize Supabase client with schema
Deno.serve(async () => {
  const sb = getServiceClient();  // Returns client with lth_pvr schema
  const org_id = Deno.env.get("ORG_ID");
  
  // 3. Query pending work
  const { data, error } = await sb
    .from("order_intents")
    .select("*")
    .eq("org_id", org_id)
    .eq("status", "pending");
  
  // 4. Process records with error handling
  for (const record of data ?? []) {
    try {
      // Business logic here
    } catch (e) {
      await logAlert(sb, "component_name", "error", e.message, { context });
    }
  }
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
});
```

**Client initialization pattern:**
```typescript
// client.ts in each edge function
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  return createClient(url, key, {
    db: { schema: "lth_pvr" }  // Sets default schema for queries
  });
}
```

### Database Query Patterns

**Schema-specific queries:**
```sql
-- From edge function (using .schema() chain)
const { data } = await supabase
  .schema("lth_pvr")
  .from("decisions_daily")
  .select("*");

-- From SQL function (explicit schema prefix)
SELECT * FROM lth_pvr.decisions_daily;
```

**Multi-org filtering (always required):**
```sql
-- Every query MUST filter by org_id for security
.eq("org_id", org_id)
```

**Trade date conventions:**
- `trade_date`: Day orders are placed (CURRENT_DATE)
- `signal_date`: Day of CI bands data used (trade_date - 1)
- `intent_date`: Synonym for trade_date in some tables

## Testing Strategy

**Test documentation location:** `docs/*_Test_Cases.md`
- Structured format: Test ID, Description, Expected Result, Actual Result, Status (PASS/SKIP/FAIL)
- Example files: `Pipeline_Resume_Test_Cases.md`, `Alert_System_Test_Cases.md`, `WebSocket_Order_Monitoring_Test_Cases.md`

**Testing via SQL Editor:**
```sql
-- Test pipeline status
SELECT lth_pvr.get_pipeline_status();

-- Test resume function
SELECT lth_pvr.resume_daily_pipeline();

-- Check alerts
SELECT * FROM public.list_lth_alert_events();
```

**Testing via PowerShell:**
```powershell
# Call edge function
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{}'
```

## Documentation Strategy

**Key documents:**
- `docs/SDD_v0.6.md` - Solution Design Document (1,700+ lines, single source of truth)
- `DEPLOYMENT_COMPLETE.md` - Current deployment status and usage instructions
- `SECRET_KEY_MIGRATION.md` - Environment variable migration guide
- `*_Build_Plan.md` - Feature implementation roadmaps

**Update pattern:** When making architectural changes, update SDD first, then code. SDD includes:
- Change log at top with version history
- Architecture diagrams and data flows
- Database schema details
- Deployment commands
- Bug fix tracking

## Common Gotchas

1. **JWT Verification:** Pipeline functions fail with 401 if JWT verification enabled. Always deploy with `--no-verify-jwt` for cron/internal functions.

2. **Schema Switching:** Forgetting `.schema("lth_pvr")` causes "relation does not exist" errors. Default schema is `public`.

3. **Trade Window:** Pipeline steps check `window_valid` (03:00-17:00 UTC). Prevent post-close execution to avoid stale data.

4. **Async pg_net Pitfall:** `SELECT net.http_post()` queues requests but causes parallel execution. Use edge function orchestrator with `await fetch()` for sequential steps.

5. **Environment Variable Names:** Legacy code may reference `SECRET_KEY` - modern standard is `SUPABASE_SERVICE_ROLE_KEY`.

6. **VALR Pair Naming:** Internal format `BTC/USDT`, VALR API format `BTCUSDT` (no slash). Use `normalisePair()` helper.

## UI Integration Notes

**Single-page app:** `ui/Advanced BTC DCA Strategy.html` (~7,000 lines)
- Global context bar: org_id, customer_id, portfolio_id selectors
- Modules: Customer Maintenance, Balance Maintenance, Transactions, Reporting, Back-Testing, Finance, Administration
- Uses vanilla JS (no frameworks), Supabase JS client v2, Tailwind CSS classes
- **Administration module (lines 2106+):** Alerts panel + Pipeline Control Panel

**Key UI patterns:**
```javascript
// Initialize Supabase client
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Call RPC function
const { data, error } = await supabase.rpc('get_pipeline_status');

// Schema-specific queries
const { data } = await supabase.schema('lth_pvr').from('decisions_daily').select('*');
```

## When to Ask for Help

1. **VALR API changes:** Exchange integration is fragile. Check docs at https://docs.valr.com before modifying.
2. **pg_cron timing:** Schedule conflicts can cause pipeline failures. Review existing jobs via `SELECT * FROM cron.job;`.
3. **RLS policies:** Multi-tenant security is critical. Test with different org_id values.
4. **Back-testing vs Live:** Ensure changes don't leak into `lth_pvr_bt` schema or vice versa.

---

**Last Updated:** 2025-12-30  
**For detailed architecture, see:** [docs/SDD_v0.6.md](docs/SDD_v0.6.md)
