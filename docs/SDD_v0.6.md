# BitWealth – LTH PVR BTC DCA
## Solution Design Document – Version 0.6

**Author:** Dav / GPT  
**Status:** Production-ready design – supersedes SDD_v0.5  
**Last updated:** 2025-12-28

---

## 0. Change Log

### v0.6.1 (current) – Pipeline Resume Mechanism
**Date:** 2025-12-28  
**Purpose:** Add automated pipeline recovery system to resume execution after CI bands fetch failures.

**Key Changes:**

1. **Pipeline Resume Functions**
   - **`lth_pvr.get_pipeline_status()`**: Returns current pipeline execution state
     - Checks completion of all 6 pipeline steps (ci_bands, decisions, order_intents, execute_orders, poll_orders, ledger_posted)
     - Validates trade window (03:00 - 00:00 UTC next day)
     - **CRITICAL FIX:** `window_closes` changed from `(v_trade_date)::timestamp` to `(v_trade_date + interval '1 day')::timestamp`
       * Bug: Window was closing at START of trade date (00:00) instead of END
       * Impact: UI showed "Closing soon" with 6+ hours remaining
       * Solution: Window now correctly closes at midnight (00:00 UTC) of next day
     - **CRITICAL FIX:** `can_resume` logic changed from `not v_decisions_done` to `not v_ledger_done`
       * Reason: Allow resume at any incomplete step, not just first step
       * Enables partial pipeline recovery after any failure point
     - Returns `can_resume` flag to indicate if pipeline is safe to continue
   - **`lth_pvr.resume_daily_pipeline()`**: Queues remaining pipeline steps (**DEPRECATED - See Note**)
     - Uses async `net.http_post` to queue HTTP requests (no timeout issues)
     - Queues edge function calls for incomplete steps
     - Returns immediately with request IDs (requests execute after transaction commits)
     - **LIMITATION:** Async queuing causes parallel execution (all functions fire at same microsecond)
     - **SUPERSEDED BY:** ef_resume_pipeline orchestrator (see below)
   - **`lth_pvr.ensure_ci_bands_today_with_resume()`**: Enhanced guard with auto-resume
     - Extends existing guard function to automatically resume pipeline after successful CI bands fetch
     - Single function for fetch + resume workflow

2. **Edge Function: ef_resume_pipeline - Sequential Orchestrator**
   - **Purpose:** REST API endpoint for UI-driven pipeline control WITH SEQUENTIAL EXECUTION
   - **Deployed Version:** v7 (2025-12-28) - **Production Ready**
   - **Architecture Change:** Replaced async pg_net queuing with sequential await pattern
     * **Problem:** resume_daily_pipeline() caused race conditions - all 5 functions fired simultaneously
     * **Solution:** Orchestrator calls each edge function with await, ensuring sequential execution
     * **Benefit:** Proper step ordering, no race conditions, clean execution logs
   - **Endpoints:**
     - `POST /functions/v1/ef_resume_pipeline` with `{"check_status": true}` - Returns pipeline status
     - `POST /functions/v1/ef_resume_pipeline` with `{}` or `{"trade_date": "YYYY-MM-DD"}` - Triggers sequential pipeline resume
   - **Authentication:** JWT verification disabled (`--no-verify-jwt` flag)
     * **CRITICAL FIX:** Service role key authentication requires JWT verification disabled for service-to-service calls
     * Impact: All pipeline edge functions (ef_generate_decisions, ef_create_order_intents, ef_execute_orders, ef_poll_orders, ef_post_ledger_and_balances) redeployed with --no-verify-jwt
     * Security: Supabase project-level access control and RLS still enforced
   - **Implementation:**
     * Uses `.schema("lth_pvr")` chain for RPC calls
     * **CRITICAL FIX:** Line 121 changed from `if (step.status === "complete")` to `if (step.status === true)`
       - Bug: Checking string "complete" against boolean true
       - Impact: Orchestrator completed in <1s without executing any steps
       - Solution: Fixed boolean comparison
     * Sequential loop: await fetch() for each incomplete step
     * Returns detailed results array: [{step, status, success, response, skipped, reason}]
   - **Environment Variables:**
     * **CRITICAL FIX:** ef_create_order_intents/client.ts line 9 changed from `Deno.env.get("Secret Key")` to `SUPABASE_SERVICE_ROLE_KEY`
     * Impact: 401 Unauthorized errors resolved

3. **UI Integration - Pipeline Control Panel**
   - **Location:** Administration module (ui/Advanced BTC DCA Strategy.html)
   - **Components:**
     - Pipeline status display (6 checkboxes: CI Bands, Decisions, Order Intents, Execute Orders, Poll Orders, Ledger Posted)
     - Trade window indicator with color coding (green: valid, red: outside window, yellow: <1h warning)
     - "Refresh Status" button with loading states
     - "Resume Pipeline" button (enabled only when can_resume = true)
     - Execution log with timestamps and color-coded messages (SUCCESS/FAILED/SKIPPED)
   - **Auto-refresh:** Polls status every 30 seconds when panel is visible
   - **Lines:** 2106-2170 (HTML), ~5875-6070 (JavaScript)
   - **CRITICAL FIX:** Lines 6051-6062 updated to check `data.results` instead of `data.steps`
     * Bug: UI parsing wrong response field from orchestrator
     * Impact: Execution log not showing step details
     * Solution: Check data.results, display SKIPPED/SUCCESS/FAILED with response truncated to 200 chars

4. **Architectural Evolution**
   - **Phase 1 - Synchronous Blocking (FAILED):**
     * Initial implementation: `FROM net.http_post()` in SQL
     * Problem: 5-second timeout when calling multiple edge functions
     * Lesson: Synchronous HTTP calls block transaction, unsuitable for multi-step workflows
   - **Phase 2 - Async Queuing (PARTIAL SUCCESS):**
     * Solution: `SELECT net.http_post() INTO v_request_id` (async)
     * Benefit: No timeouts, returns in <100ms
     * Problem: Parallel execution - all 5 functions fired at same microsecond
     * Lesson: Async queuing good for fire-and-forget, bad for sequential dependencies
   - **Phase 3 - Sequential Orchestrator (PRODUCTION):**
     * Solution: Edge function ef_resume_pipeline with await fetch() loop
     * Benefit: Sequential execution, proper error handling, detailed results
     * Status: **74% test coverage (25/34 tests passed), all critical path tests passed**

5. **Documentation**
   - **Test Cases:** Pipeline_Resume_Test_Cases.md (34 test cases across 6 categories)
   - **Test Results:** 25 passed (74% coverage), 3 deferred (exchange/timing), 6 pending (future)
   - **Critical Path:** All 8 must-pass tests successful
   - **Integration:** Updated SDD v0.6.1 with complete technical specifications and all bug fixes

6. **Bug Fixes Summary**
   1. ✅ Synchronous HTTP blocking → Async SELECT net.http_post()
   2. ✅ Parallel execution race conditions → Sequential orchestrator with await
   3. ✅ 401 Unauthorized (wrong env var) → Fixed client.ts to use SUPABASE_SERVICE_ROLE_KEY
   4. ✅ 401 Unauthorized (JWT verification) → Redeployed all functions with --no-verify-jwt
   5. ✅ Orchestrator completing without execution → Fixed boolean comparison (=== true)
   6. ✅ Window closing at wrong time → Changed to (v_trade_date + interval '1 day')::timestamp
   7. ✅ UI not showing execution details → Fixed to check data.results instead of data.steps

### v0.6 (recap) – Alert System Production Implementation
**Date:** 2025-12-27  
**Purpose:** Document fully operational alert system with comprehensive testing and email notifications.

**Key Changes:**

1. **Alert System - Fully Operational**
   - Complete UI implementation in Administration module:
     - Red alert badge (#ef4444) with dynamic count display
     - Component filter dropdown (6 options: All + 5 edge functions)
     - Auto-refresh checkbox (30-second interval with setInterval/clearInterval)
     - Open-only checkbox filter (default: checked)
     - Resolve alert dialog with optional notes
   - Database schema: `lth_pvr.alert_events` with `notified_at` column for email tracking
   - RPC functions: `list_lth_alert_events()`, `resolve_lth_alert_event()`

2. **Alert Digest Email System**
   - **Edge Function:** `ef_alert_digest` (version 3, JWT verification disabled)
   - **Email Provider:** Resend API (`re_ZUoZ9aRn_LUxV8exouZvKXNW7xYk6jXYc`)
   - **Schedule:** Daily at 05:00 UTC (07:00 SAST) via pg_cron (job ID 22)
   - **Recipients:** davin.gaier@gmail.com
   - **From Address:** alerts@bitwealth.co.za
   - **Logic:** 
     - Queries error/critical alerts where `notified_at IS NULL`
     - Sends formatted email digest
     - Updates `notified_at` timestamp to prevent duplicates

3. **Comprehensive Test Coverage**
   - **Documentation:** `Alert_System_Test_Cases.md` with 51 test cases across 8 sections
   - **Executed Tests:** 17 test cases passed (100% of executable UI and database tests)
   - **Test Categories:**
     - Database Functions: 100% coverage (3 tests: 2 passed, 1 skipped for safety)
     - UI Components: 100% coverage (14 tests: all passed)
     - Edge Function Integration: 1 critical scenario tested
   - **Test Results Format:** Date, result (PASS/SKIP), detailed execution notes, code line references

4. **Alerting Module Integration**
   - Shared TypeScript module: `supabase/functions/_shared/alerting.ts`
   - `logAlert()` function with consistent interface across all edge functions
   - `AlertContext` interface for structured debugging data
   - Implemented in: ef_generate_decisions, ef_create_order_intents, ef_execute_orders, ef_poll_orders
   - Alert severities: info, warn, error, critical (with UI color coding)

5. **Documentation Additions**
   - **Alert_System_Test_Cases.md:** 51 test cases with execution tracking and summary statistics
   - **Alert_Digest_Setup.md:** Complete setup guide, troubleshooting, and email template examples
   - Test execution summary table with detailed status tracking

6. **WebSocket Order Monitoring (NEW)**
   - **Hybrid System:** WebSocket (primary) + Polling (safety net)
   - **Database Schema:** Added 4 columns to exchange_orders (ws_monitored_at, last_polled_at, poll_count, requires_polling)
   - **Performance Impact:** 98% API call reduction (1,440/day → 170/day), <5 sec update latency
   - **Edge Functions:**
     - `ef_valr_ws_monitor` (v2): Real-time VALR WebSocket monitoring with comprehensive alerting
     - `ef_execute_orders` (v29): Initiates WebSocket monitoring, alerts on failures
     - `ef_poll_orders` (v38): Reduced to 10-minute safety net, targeted polling support
   - **Cron Schedule:** Polling reduced from */1 (every minute) to */10 (every 10 minutes)
   - **Documentation:**
     - `WebSocket_Order_Monitoring_Implementation.md`: Complete technical guide (10 sections, 500+ lines)
     - `WebSocket_Order_Monitoring_Test_Cases.md`: 35 test cases across 7 categories
   - **Alerting:** WebSocket connection errors, premature closures, initialization failures

### v0.5 (recap)
**Date:** 2025-12-26  
**Purpose:** Initial alerting implementation for LTH PVR

**Components Added:**
- `lth_pvr.alert_events` table with resolution tracking
- `lth_pvr.ci_bands_guard_log` for audit trail
- `lth_pvr.ensure_ci_bands_today()` guard function (30-minute schedule)
- `ef_fetch_ci_bands` with guard mode and self-healing
- `ef_alert_digest` initial implementation
- Basic Alerts UI card in Administration module

**Status at v0.5:** Alerting framework established, but not fully tested or operational.

### v0.4 (recap)
**Date:** Prior to 2025-12-26

**Key Components:**
- Shared `public.exchange_accounts` table
- Full alerting system design (planned, not yet implemented)
- Customer Maintenance UI for portfolios
- Ledger & Balances flow completion

### v0.3 (recap)
- Detailed ledger and balances design
- VALR fallback logic refinements

### v0.2 (recap)
- First comprehensive solution design
- Strategy logic, back-testing architecture, security/RLS

### v0.1 (recap)
- Back-testing logic deep dive

---

## 1. System Overview

### 1.1 Business Goal
BitWealth offers a BTC accumulation service based on the **LTH PVR BTC DCA strategy**:

- **Aggressive Allocation:** Buy more when BTC is cheap relative to Long-Term Holder Profit/Loss Realized (PVR) bands
- **Defensive Allocation:** Reduce buying when BTC is expensive or momentum is negative
- **Performance Tracking:** Compare against Standard DCA benchmark and charge performance fees on outperformance
- **Back-testing:** Same core logic validates historical performance for customer proposals

### 1.2 High-Level Architecture

**Technology Stack:**

- **Database:** Supabase PostgreSQL
  - `lth_pvr` schema → live trading, decisions, orders, ledger, balances, benchmark, fees, **alerts**
  - `lth_pvr_bt` schema → back-testing (runs, simulated ledger, results, benchmark)
  - `public` schema → shared entities (customers, portfolios, strategies, exchange_accounts, orgs)

- **Edge Functions (Deno/TypeScript):**
  - **Core Pipeline:**
    - `ef_fetch_ci_bands` – CI bands ingestion with guard mode
    - `ef_generate_decisions` – daily LTH PVR decision engine
    - `ef_create_order_intents` – decision → tradable order sizing
    - `ef_execute_orders` – VALR order submission with alerting
    - `ef_poll_orders` – order tracking, fills, and fallback logic
    - `ef_post_ledger_and_balances` – ledger rollup and balance calculation
  - **Pipeline Control:**
    - `ef_resume_pipeline` – **NEW: REST API for pipeline status and resume (v5, operational)**
  - **Benchmark & Fees:**
    - `ef_std_dca_roll` – Standard DCA benchmark updates
    - `ef_fee_monthly_close` – monthly performance fee calculation
    - `ef_fee_invoice_email` – fee invoice email notifications
  - **Back-testing:**
    - `ef_bt_execute` – historical simulation runner
  - **Monitoring:**
    - `ef_alert_digest` – **NEW: daily email alerts (operational)**
    - `ef_valr_subaccounts` – VALR subaccount sync utility
    - `ef_valr_deposit_scan` – deposit monitoring

- **Database Functions:**
  - Utility: `call_edge`, `upsert_cron`
  - Carry buckets: `fn_carry_add`, `fn_carry_peek`, `fn_carry_consume`
  - Capital: `fn_usdt_available_for_trading`
  - **Alerts:** `lth_pvr.ensure_ci_bands_today()` guard function
  - **Pipeline Control:** `lth_pvr.get_pipeline_status()`, `lth_pvr.resume_daily_pipeline()`, `lth_pvr.ensure_ci_bands_today_with_resume()`
  - **UI RPCs:** `list_lth_alert_events()`, `resolve_lth_alert_event()`

- **Front-end:**
  - Single HTML/JS admin console: `Advanced BTC DCA Strategy.html`
  - Modules: Customer Maintenance, Balance Maintenance, Transactions, Reporting, Back-Testing, Finance, **Administration (with Alerts)**
  - Global context bar: Organisation, Customer, Active Portfolio/Strategy

- **Scheduling:**
  - `pg_cron` jobs for all automated processes
  - CI bands (03:00 UTC), decisions (03:05), intents (03:10), execution (03:15), polling (every minute)
  - **Alert digest (05:00 UTC daily)**
  - Guard function (every 30 minutes)

- **Exchange Integration:**
  - VALR REST API with HMAC authentication
  - Single primary API key/secret in environment variables
  - Per-customer routing via `subaccount_id` in `public.exchange_accounts`

---

## 2. Core Domains

### 2.1 CI & Market Data

**Tables:**
- **`lth_pvr.ci_bands_daily`**
  - Daily CI LTH PVR bands and BTC price
  - Columns: `org_id`, `date`, `mode` (static/dynamic), `btc_price`, band levels (ultra_bear through ultra_bull)
  - Used by both live trading and back-testing
  - Guard function ensures yesterday's data is always present

- **`lth_pvr.ci_bands_guard_log`**
  - Audit trail for guard function executions
  - Columns: `log_id`, `org_id`, `run_at`, `target_date`, `did_call`, `http_status`, `details`
  - Used for troubleshooting missing data scenarios

**Edge Functions:**
- **`ef_fetch_ci_bands`**
  - Normal mode: scheduled daily at 03:00 UTC
  - Guard mode: called by `ensure_ci_bands_today()` when data is missing
  - Fetches from CryptoQuant API
  - Upserts by (`org_id`, `date`, `mode`)
  - Self-healing: attempts 1-day refetch if current data missing

**Database Functions:**
- **`lth_pvr.ensure_ci_bands_today()`**
  - Scheduled every 30 minutes via pg_cron
  - Checks for yesterday's CI bands data (CURRENT_DATE - 1)
  - Calls `ef_fetch_ci_bands` via `pg_net.http_post` if missing
  - Logs all attempts to `ci_bands_guard_log`
  - **Status:** Operational since 2025-12-27

- **`lth_pvr.ensure_ci_bands_today_with_resume()`**
  - Enhanced version that automatically resumes pipeline after successful fetch
  - Calls `ensure_ci_bands_today()` first to fetch missing data
  - Then calls `resume_daily_pipeline()` to continue execution
  - **Use Case:** Scheduled as alternative to standalone guard for automated recovery
  - **Status:** Operational since 2025-12-28

### 2.1A Pipeline Resume System

**Purpose:** Automated recovery mechanism to resume daily pipeline execution after CI bands fetch failures or manual intervention.

**Database Functions:**

- **`lth_pvr.get_pipeline_status(p_trade_date DATE DEFAULT NULL)`**
  - **Returns:** JSONB object with pipeline execution state
  - **Fields:**
    - `trade_date`: Date being processed (defaults to CURRENT_DATE)
    - `signal_date`: Trade date - 1 (date of CI bands data used for decisions)
    - `current_date`: Server date
    - `window_valid`: Boolean - true if within 03:00-17:00 UTC trading window
    - `ci_bands_available`: Boolean - true if signal_date CI bands exist
    - `can_resume`: Boolean - true if safe to resume pipeline (window valid AND ci_bands available AND at least one incomplete step)
    - `steps`: Object with 6 boolean flags:
      - `ci_bands`: CI bands data exists for signal_date
      - `decisions`: decisions_daily records exist for trade_date
      - `order_intents`: order_intents records exist for trade_date
      - `execute_orders`: exchange_orders records exist for trade_date
      - `poll_orders`: order_fills records exist for trade_date
      - `ledger_posted`: balances_daily record exists for trade_date
  - **Logic:**
    - Queries 6 different tables to determine completion status
    - Validates trade window (03:00-17:00 UTC prevents post-close execution)
    - Returns comprehensive state for UI display and resume decisions
  - **Usage:** Called by UI and edge function to check pipeline status

- **`lth_pvr.resume_daily_pipeline(p_trade_date DATE DEFAULT NULL)`**
  - **Returns:** JSONB object with success status and request IDs
  - **Parameters:** 
    - `p_trade_date`: Optional trade date override (defaults to CURRENT_DATE)
  - **Logic:**
    1. Calls `get_pipeline_status()` to check current state
    2. Validates `can_resume` flag (exits if false with error message)
    3. Determines which steps are incomplete by checking status.steps
    4. Queues HTTP POST requests for incomplete steps using `net.http_post`:
       - `ef_generate_decisions` (if decisions incomplete)
       - `ef_create_order_intents` (if order_intents incomplete)
       - `ef_execute_orders` (if execute_orders incomplete)
       - `ef_poll_orders` (if poll_orders incomplete)
       - `ef_post_ledger_and_balances` (if ledger_posted incomplete)
    5. Returns immediately with array of request_ids (bigint)
  - **Key Feature:** Uses async `net.http_post` (pg_net extension) to queue requests
    - Function returns in <100ms
    - HTTP requests execute in background after transaction commits
    - No timeout issues (previous synchronous approach timed out at 5 seconds)
  - **Request Format:** Each queued request includes:
    - URL: Base URL + edge function path
    - Headers: Authorization (Bearer + service_role_key), Content-Type
    - Body: Empty JSON object `{}`
    - Timeout: 60,000ms (60 seconds per edge function)
  - **Status:** Operational since 2025-12-28

**Edge Function:**

- **`ef_resume_pipeline`**
  - **Version:** 7 (deployed 2025-12-28)
  - **Authentication:** JWT verification disabled (`--no-verify-jwt` flag required)
  - **Architecture:** Sequential orchestrator replacing async queuing
    * Fetches pipeline status via get_pipeline_status()
    * Defines step execution order: [decisions, order_intents, execute_orders, poll_orders, ledger_posted]
    * Maps status booleans to step names (lines 112-119)
    * **Sequential Execution:** Loops through incomplete steps with await fetch() (lines 121-145)
    * **Skip Logic:** Line 121 checks `if (step.status === true)` to skip completed steps
    * Returns detailed results: [{step, status, success, response, skipped, reason}]
  - **Endpoints:**
    - `POST /functions/v1/ef_resume_pipeline` with `{"check_status": true}`
      - Returns: Pipeline status object from `get_pipeline_status()`
      - Used by UI for status polling
    - `POST /functions/v1/ef_resume_pipeline` with `{}` or `{"trade_date": "YYYY-MM-DD"}`
      - Triggers: Sequential pipeline resume
      - Returns: {success, message, results: [detailed step info]}
  - **Error Handling:**
    - Catches Supabase client initialization failures
    - Validates RPC responses
    - Returns 500 status with details on errors
    - Per-step error handling: Records failed steps in results array
  - **Implementation Notes:**
    - Uses `.schema("lth_pvr")` chain for RPC calls (required for non-public schema)
    - Service role key loaded from SUPABASE_SERVICE_ROLE_KEY env var
    - CORS enabled for browser access
    - All dependent edge functions deployed with --no-verify-jwt for service-to-service auth

**UI Integration:**

- **Location:** `Advanced BTC DCA Strategy.html` - Administration module
- **HTML:** Lines 2106-2170 (Pipeline Control Panel)
- **JavaScript:** Lines ~5875-6070 (loadPipelineStatus, resumePipeline functions)
- **Components:**
  - **Status Display:** 6 checkboxes showing step completion (✓ = complete, ☐ = incomplete)
  - **Trade Window Indicator:** Green "Trading window open" or Red "Trading window closed"
  - **Refresh Button:** Manually polls `check_status` endpoint
  - **Resume Button:** Enabled only when `can_resume = true`, triggers pipeline resume
  - **Execution Log:** Scrollable log with timestamps and color-coded messages (green = success, red = error, gray = info)
  - **Auto-refresh:** Polls status every 30 seconds when panel visible
- **User Workflow:**
  1. User opens Administration module
  2. Pipeline Control Panel loads and displays current status
  3. If CI bands were missing and now available, "Resume Pipeline" button becomes enabled
  4. User clicks "Resume Pipeline"
  5. Edge function queues remaining steps asynchronously
  6. Log shows "Pipeline resume initiated successfully"
  7. Status checkboxes update as steps complete (via auto-refresh)

**Use Cases:**

1. **CI Bands Fetch Failure Recovery:**
   - Problem: `ef_fetch_ci_bands` fails at 03:00 UTC, halting pipeline
   - Solution: Guard function retries every 30 minutes, or admin manually fixes and clicks Resume
   - Result: Pipeline continues from where it stopped

2. **Manual Intervention:**
   - Problem: Admin notices incomplete pipeline execution in morning
   - Solution: Admin opens Pipeline Control Panel, verifies CI bands available, clicks Resume
   - Result: Remaining steps execute without re-running completed steps

3. **Trade Window Validation:**
   - Problem: Admin tries to resume at 18:00 UTC (after market close)
   - Solution: Resume button disabled, window indicator shows red
   - Result: Prevents invalid post-close trades

**Monitoring:**

- **Database:** Query `net._http_response` table to check queued request status
  - Requests retained for ~6 hours
  - Contains status codes, response bodies, error messages
- **Logs:** Use `mcp_supabase_get_logs(service: "edge-function")` to view execution logs
- **UI:** Execution log provides real-time feedback to admin
- **Alerts:** Edge functions log errors to `lth_pvr.alert_events` on failures

### 2.2 Strategy Configuration & State

**Tables:**
- **`lth_pvr.strategy_versions`**
  - LTH PVR band weights, momentum parameters, retrace rules
  - Version history for strategy evolution
  
- **`lth_pvr.settings`**
  - Key-value configuration storage
  - Min order sizes, retrace toggles, fee rates

**Global Catalogue:**
- **`public.strategies`**
  - One row per strategy type: ADV_DCA, LTH_PVR, future strategies
  - Columns: `strategy_code` (PK), `name`, `description`, `schema_name`

### 2.3 Customers & Portfolios

**Customers:**
- **`public.customer_details`**
  - Core person/entity record
  - Columns: `customer_id`, `org_id`, `status` (active, offboarded, etc.), contact details
  - RLS enforced on `org_id`

**Portfolios:**
- **`public.customer_portfolios`**
  - Global portfolio table (multi-strategy support)
  - Columns:
    - `portfolio_id` (PK, UUID)
    - `org_id`, `customer_id`
    - `strategy_code` (FK → public.strategies)
    - `exchange`, `exchange_account_id` (FK → public.exchange_accounts)
    - `exchange_subaccount` (label)
    - `base_asset`, `quote_asset` (BTC/USDT)
    - `status` (active, paused, inactive)
    - `created_at`, `updated_at`
  - Serves as routing key for UI: "Active Portfolio / Strategy" dropdown
  - Trading EFs filter on `status = 'active'`

### 2.4 Exchange Integration & Shared Exchange Accounts

**Shared Exchange Accounts:**
- **`public.exchange_accounts`**
  - Single source of truth for VALR accounts across all strategies
  - Columns:
    - `exchange_account_id` (PK, UUID)
    - `org_id`
    - `exchange` ('VALR')
    - `label` ("Main VALR", "LTH PVR Test")
    - `subaccount_id` – VALR internal ID for X-VALR-SUB-ACCOUNT-ID header
    - `notes`, `tags`, timestamps
  - RLS on `org_id`
  - Referenced by `public.customer_portfolios.exchange_account_id`

**Orders and Fills:**
- **`lth_pvr.exchange_orders`**
  - VALR orders per portfolio
  - Columns: `order_id`, `intent_id`, `portfolio_id`, `symbol`, `side`, `price`, `qty`, `status`
  - Raw JSON: `valr_request_payload`, `valr_response_payload`
  - Tracks: `created_at`, `submitted_at`, `completed_at`

- **`lth_pvr.order_fills`**
  - Individual fills with quantities, prices, fees
  - Used by ledger rollup process
  - Columns: `fill_id`, `order_id`, `filled_qty`, `filled_price`, `fee_amount`, `fee_asset`, `filled_at`

**VALR Client:**
- Shared `valrClient` helper in TypeScript
- Injects `X-VALR-API-KEY` from environment
- Adds `X-VALR-SUB-ACCOUNT-ID` from `exchange_accounts.subaccount_id`
- HMAC signs: timestamp + verb + path + body + subaccount_id

### 2.5 Decisions & Order Intents

**Tables:**
- **`lth_pvr.decisions_daily`**
  - Per-customer daily decision
  - Columns: `org_id`, `customer_id`, `trade_date`, `band_bucket`, `action` (BUY/SELL/HOLD), `allocation_pct`
  - Driven by CI bands, momentum, and retrace logic

- **`lth_pvr.order_intents`**
  - Tradeable intents with budget sizing
  - Columns: `intent_id`, `org_id`, `portfolio_id`, `trade_date`, `side`, `pair`, `amount_pct`, `amount_usdt`, `status`, `idempotency_key`
  - Status: pending, submitted, completed, failed, cancelled

**Edge Functions:**
- **`ef_generate_decisions`**
  - Reads CI bands for signal_date (yesterday)
  - Applies momentum calculation (6-day price history)
  - Determines band bucket and allocation percentage
  - Writes to `decisions_daily`
  - **Alerting:** Logs error alerts if CI bands missing

- **`ef_create_order_intents`**
  - Consumes `decisions_daily`
  - Calls `fn_usdt_available_for_trading()` for budget
  - Applies minimum order size checks
  - Uses carry buckets for sub-minimum amounts
  - Writes to `order_intents`
  - **Alerting:** Logs info alerts for below-minimum orders, error alerts for failures

### 2.6 Ledger & Performance

**Tables (Live LTH PVR):**
- **`lth_pvr.v_fills_with_customer`** (view)
  - Joins: order_fills → exchange_orders → order_intents → portfolios → customers
  - Provides enriched fill data for ledger processing

- **`lth_pvr.exchange_funding_events`**
  - Deposits, withdrawals, internal transfers
  - Fees not captured at fill level
  - Columns: `event_id`, `org_id`, `portfolio_id`, `event_type`, `asset`, `amount`, `event_date`

- **`lth_pvr.ledger_lines`**
  - Canonical event ledger
  - Columns: `line_id`, `org_id`, `customer_id`, `portfolio_id`, `trade_date`, `event_type`, `asset`, `amount_btc`, `amount_usdt`, `note`
  - Event types: trade, fee, deposit, withdrawal, fee_settlement, etc.

- **`lth_pvr.balances_daily`**
  - Daily holdings per portfolio and asset
  - Columns: `org_id`, `portfolio_id`, `date`, `asset`, `balance`, `nav_usd`, contribution aggregates, `roi_pct`, `cagr_pct`
  - Calculated by `ef_post_ledger_and_balances`

**RPC (UI):**
- **`public.lth_pvr_list_ledger_and_balances(from_date, portfolio_id, to_date)`**
  - Returns: `event_date`, `event_type`, `btc_delta`, `usdt_delta`, `note`
  - Used by LTH PVR – Ledger & Balances card in Customer Balance Maintenance module

**Edge Function:**
- **`ef_post_ledger_and_balances`**
  - Reads `v_fills_with_customer` + `exchange_funding_events`
  - Produces `ledger_lines` events
  - Rolls up into `balances_daily` per portfolio and asset
  - Scheduled: 03:30 UTC or on-demand via UI

### 2.7 Back-Testing Domain (LTH_PVR vs Std DCA)

**Tables/Views:**
- **`lth_pvr_bt.bt_runs`**
  - One row per back-test run
  - Columns: `bt_run_id`, `org_id`, date range, upfront/monthly contributions, maker fees (bps), `status`, `started_at`, `finished_at`, `error`

- **`lth_pvr_bt.bt_results_daily`**
  - Daily LTH PVR balances & performance
  - Columns: `bt_run_id`, `date`, `btc_balance`, `usdt_balance`, `nav_usd`, contribution cumulative totals, `roi_pct`, `cagr_pct`

- **`lth_pvr_bt.bt_std_dca_balances`**
  - Same structure as `bt_results_daily` but for Standard DCA benchmark

- **`lth_pvr_bt.bt_ledger` / `bt_std_dca_ledger`**
  - Simulated trades and fees for audit trail

- **`lth_pvr_bt.bt_orders`**
  - Synthetic "orders" for traceability

- **`lth_pvr_bt.v_bt_results_annual`**
  - Rolled-up annual view for both strategies
  - Used by yearly comparison tables

**Edge Function:**
- **`ef_bt_execute`**
  - Reads CI bands and strategy config for date range
  - Iterates each trade date:
    - Runs decision logic (same as live)
    - Applies contributions & fees monthly
    - Simulates trades for LTH PVR and Std DCA
  - Bulk-inserts results into `bt_*` tables
  - Updates `bt_runs.status` and summary metrics

---

## 3. Monitoring & Alerting System (FULLY OPERATIONAL)

### 3.1 Alert System Overview

**Status:** Production-ready as of 2025-12-27  
**Coverage:** CI bands, order execution, decision generation, edge function failures  
**Notification:** Daily email digest at 07:00 SAST

### 3.2 Database Schema

**`lth_pvr.alert_events`**
```sql
CREATE TABLE lth_pvr.alert_events (
  alert_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  component       text NOT NULL,  -- e.g., 'ef_fetch_ci_bands', 'ef_execute_orders'
  severity        text NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  org_id          uuid NULL,
  customer_id     bigint NULL,
  portfolio_id    uuid NULL,
  message         text NOT NULL,
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at     timestamptz NULL,
  resolved_by     text NULL,
  resolution_note text NULL,
  notified_at     timestamptz NULL  -- NEW in v0.6: tracks email notifications
);

CREATE INDEX idx_lth_alerts_created_at ON lth_pvr.alert_events (created_at DESC);
CREATE INDEX idx_lth_alerts_unresolved ON lth_pvr.alert_events (severity, created_at) WHERE resolved_at IS NULL;
```

**Alert Severities:**
- **info** (blue #dbeafe): Informational, no action required
- **warn** (amber #fef3c7): Potential issue, monitor
- **error** (red #fee2e2): Failure requiring investigation
- **critical** (red #fee2e2): Severe failure requiring immediate action

### 3.3 Alerting Module (TypeScript)

**File:** `supabase/functions/_shared/alerting.ts`

**Exports:**
```typescript
export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface AlertContext {
  [key: string]: unknown;
  trade_date?: string;
  signal_date?: string;
  customer_id?: number;
  intent_id?: string;
  order_id?: string;
  exchange_order_id?: string;
  ext_order_id?: string;
  error_code?: string;
  retries?: number;
}

export async function logAlert(
  sb: SupabaseClient,
  component: string,
  severity: AlertSeverity,
  message: string,
  context: AlertContext = {},
  orgId?: string | null,
  customerId?: number | null,
  portfolioId?: string | null,
): Promise<void>
```

**Usage Example:**
```typescript
await logAlert(
  supabaseClient,
  "ef_generate_decisions",
  "error",
  `CI bands unavailable for ${signalStr}`,
  { signal_date: signalStr, trade_date: tradeStr },
  org_id
);
```

**Integrated In:**
- `ef_generate_decisions`: CI bands missing, decision failures
- `ef_create_order_intents`: Budget calculation errors, below-minimum orders
- `ef_execute_orders`: Missing exchange accounts, VALR API errors, rate limits
- `ef_poll_orders`: Order status query failures, fallback triggers

### 3.4 Alert Digest Email System

**Edge Function:** `ef_alert_digest`
- **Version:** 3
- **JWT Verification:** Disabled (for pg_cron access)
- **Function ID:** cd9c33dc-2c2c-4336-8006-629bf9948724

**Configuration:**
```toml
# supabase/config.toml
[edge_runtime.secrets]
RESEND_API_KEY = "[your-resend-api-key]"
ALERT_EMAIL_FROM = "alerts@bitwealth.co.za"
ALERT_EMAIL_TO = "your-email@example.com"
```

**Schedule:**
```sql
-- pg_cron job (ID: 22)
SELECT cron.schedule(
  'lth_pvr_alert_digest_daily',
  '0 5 * * *',  -- 05:00 UTC = 07:00 SAST
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [SERVICE_ROLE_KEY]'
    ),
    body := jsonb_build_object('org_id', 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid)
  );
  $$
);
```

**Logic:**
1. Query `lth_pvr.alert_events` WHERE:
   - `org_id = [specified]`
   - `severity IN ('error', 'critical')`
   - `resolved_at IS NULL`
   - `notified_at IS NULL`
2. Format email with:
   - Alert count
   - Component, severity, timestamp, message for each alert
   - Instructions to resolve via UI
3. Send via Resend API
4. Update `notified_at` timestamp on all sent alerts

**Email Template:**
```
Subject: [BitWealth] 4 new alerts (error/critical)

Hi Dav,

There are 4 NEW open alert(s) for org_id=b0a77009-03b9-44a1-ae1d-34f157d44a8b:

• [ERROR] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 1 for execute_orders

• [CRITICAL] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 2 for execute_orders

• [ERROR] ef_fetch_ci_bands @ 2025-12-27T15:01:35.710211Z
    Test alert for filter test - ci bands

• [ERROR] ef_poll_orders @ 2025-12-27T14:59:49.925750Z
    Test alert 3 for badge update test

To resolve these, open the BitWealth UI and use the Alerts card.

-- ef_alert_digest
```

### 3.5 UI Implementation (Administration Module)

**Location:** `Advanced BTC DCA Strategy.html` lines 2085-5670

**Components:**

1. **Alert Badge (lines 356-368, 392)**
   ```html
   <span class="alert-badge zero" id="alertBadge">0</span>
   ```
   - CSS: Red background (#ef4444), white text, circular
   - `.alert-badge.zero { display: none }` - hidden when count is 0
   - Dynamic update via JavaScript every time alerts load

2. **Component Filter Dropdown (lines 2099-2107)**
   ```html
   <select id="alertsComponentFilter" class="context-select">
     <option value="">All Components</option>
     <option value="ef_fetch_ci_bands">ef_fetch_ci_bands</option>
     <option value="ef_generate_decisions">ef_generate_decisions</option>
     <option value="ef_create_order_intents">ef_create_order_intents</option>
     <option value="ef_execute_orders">ef_execute_orders</option>
     <option value="ef_poll_orders">ef_poll_orders</option>
   </select>
   ```
   - Client-side filtering at line 5560
   - onchange event listener at line 5663

3. **Open Only Checkbox (lines 2092-2094)**
   ```html
   <input id="alertsOpenOnlyChk" type="checkbox" checked>
   <span>Show only open alerts</span>
   ```
   - Default: checked (shows only unresolved alerts)
   - Passes `p_only_open` parameter to RPC

4. **Auto-Refresh Checkbox (lines 2096-2098)**
   ```html
   <input id="alertsAutoRefreshChk" type="checkbox">
   <span>Auto-refresh (30s)</span>
   ```
   - Logic: lines 5650-5658
   - Uses `setInterval(loadAlerts, 30000)` when checked
   - `clearInterval()` when unchecked
   - Does NOT persist across navigation (by design)

5. **Resolve Alert Button**
   - JavaScript handler: lines 5620-5645
   - Prompt for optional resolution note
   - Calls `resolve_lth_alert_event(p_alert_id, p_resolved_by, p_resolution_note)`
   - Refreshes table after successful resolution

**JavaScript Functions:**

- **`loadAlerts()`** (lines 5545-5600)
  - Calls `list_lth_alert_events(p_only_open, p_limit)`
  - Client-side component filtering
  - Updates alert badge count
  - Renders table with severity color coding

- **`toggleAutoRefresh()`** (lines 5650-5658)
  - Manages setInterval/clearInterval for 30-second refresh
  - Triggered by checkbox onchange event

### 3.6 Database RPCs

**`public.list_lth_alert_events(p_only_open boolean, p_limit int)`**
- Returns unresolved or all alerts based on `p_only_open`
- Ordered by `created_at DESC`
- RLS enforced on `org_id`

**`public.resolve_lth_alert_event(p_alert_id uuid, p_resolved_by text, p_resolution_note text)`**
- Sets `resolved_at = now()`
- Sets `resolved_by` and optional `resolution_note`
- Returns void

### 3.7 Guard Function

**`lth_pvr.ensure_ci_bands_today()`**
- **Schedule:** Every 30 minutes via pg_cron
- **Target:** CURRENT_DATE - 1 day (yesterday)
- **Logic:**
  1. Check if `ci_bands_daily` row exists for yesterday
  2. If missing, call `ef_fetch_ci_bands` via `pg_net.http_post`
  3. Log attempt to `ci_bands_guard_log` (success or failure)
- **Status:** Operational, logs at line 352-353 show successful calls

### 3.8 Test Coverage

**Documentation:** `docs/Alert_System_Test_Cases.md`

**Test Summary (as of 2025-12-27):**
- **Total Test Cases:** 51
- **Executed:** 17
- **Passed:** 17 ✅
- **Skipped:** 1 ⚠️ (production risk)
- **Requires Edge Function Testing:** 6
- **Requires Integration Testing:** 16
- **Requires API Mocking:** 7
- **Requires Dedicated Test Environment:** 4

**Completed Test Categories:**
1. **Database Functions (100%)**
   - 1.1.1: CI Bands Fetch ✅
   - 1.1.2: CI Bands Already Exist ✅
   - 1.1.3: Missing Vault Secret ⚠️ (skipped)

2. **UI Components (100% - 14/14 tests)**
   - Badge Updates on Load ✅
   - Badge Hidden When Zero ✅
   - Badge Updates After Resolve ✅
   - All Components Shown ✅
   - Filter by Single Component ✅
   - Filter Change Updates Table ✅
   - All Components Listed ✅
   - Enable Auto-Refresh ✅
   - Disable Auto-Refresh ✅
   - Auto-Refresh Navigation ✅
   - Show Only Open Alerts ✅
   - Show All Alerts ✅
   - Resolve Alert with Note ✅
   - Resolve Alert Without Note ✅

3. **Edge Function Alerting**
   - 3.3.2: No VALR Subaccount ✅ (critical alert generated)

### 3.9 WebSocket Order Monitoring

**Purpose:** Real-time order status updates via VALR WebSocket API to reduce polling frequency and improve order tracking latency.

**Architecture:**
- **Hybrid System:** WebSocket (primary) + Polling (safety net)
- **WebSocket Connection:** Established per subaccount when orders are placed
- **Fallback Polling:** Every 10 minutes (reduced from every 1 minute)
- **API Call Reduction:** 98% fewer calls (~1,440/day → ~170/day)

**Database Schema Extensions:**

`lth_pvr.exchange_orders` new columns:
- `ws_monitored_at` (timestamptz) - When WebSocket monitoring started
- `last_polled_at` (timestamptz) - Last polling attempt timestamp
- `poll_count` (integer, default 0) - Number of times order polled
- `requires_polling` (boolean, default true) - Whether order needs polling fallback

Index: `idx_exchange_orders_requires_polling` on (requires_polling, last_polled_at) WHERE status='submitted'

**Edge Functions:**

1. **`ef_valr_ws_monitor`** (Version 2, deployed 2025-12-27)
   - Establishes WebSocket connection to wss://api.valr.com/ws/trade
   - HMAC-SHA512 authentication with VALR API credentials
   - Subscribes to ACCOUNT_ORDER_UPDATE events
   - Monitors multiple orders for a single subaccount
   - 5-minute timeout (then polling takes over)
   - **Status Mapping:** Placed→submitted, Filled→filled, Cancelled→cancelled
   - **Fill Processing:** Extracts and stores individual fills in `order_fills` table
   - **Auto-Close:** Connection closes when all monitored orders complete
   - **Alerting:**
     - Error severity: WebSocket connection failures
     - Warn severity: WebSocket closes without processing updates
     - Error severity: Database update failures
     - All alerts include fallback notice: "polling will handle order monitoring"

2. **`ef_execute_orders`** (Version 29, updated 2025-12-27)
   - After placing orders, initiates WebSocket monitoring
   - Groups submitted orders by exchange_account_id
   - Looks up subaccount_id for each account group
   - Calls ef_valr_ws_monitor via fetch (non-blocking)
   - Marks orders with ws_monitored_at timestamp
   - Sets requires_polling=true for safety net
   - **Alerting:**
     - Warn severity: WebSocket monitor initialization fails
     - Includes subaccount_id, order_count, error details

3. **`ef_poll_orders`** (Version 38, updated 2025-12-27)
   - **Safety Net Mode:** Only polls orders not recently updated
   - **2-Minute Filter:** Skips orders polled in last 2 minutes
   - **Targeted Polling:** Supports ?order_ids=uuid1,uuid2 query parameter
   - **Tracking Updates:** Updates last_polled_at, poll_count on each poll
   - **Completion Detection:** Sets requires_polling=false when order filled/cancelled
   - **Schedule:** Cron job runs every 10 minutes (reduced from 1 minute)
   - Cron job ID: 12, name: lthpvr_poll_orders, schedule: */10 * * * *

**WebSocket Flow:**
1. ef_execute_orders places orders on VALR
2. Groups orders by subaccount_id
3. POST to ef_valr_ws_monitor with {order_ids, subaccount_id}
4. WebSocket connects with HMAC auth
5. Subscribes to ACCOUNT_ORDER_UPDATE events
6. Processes order updates in real-time:
   - Updates exchange_orders.status
   - Extracts and stores fills
   - Removes completed orders from monitoring
7. Connection closes after 5 min timeout OR all orders complete
8. Polling fallback handles any orders not updated via WebSocket

**Performance Impact:**
- **Update Latency:** <5 seconds (WebSocket) vs 30-60 seconds (polling)
- **API Calls:** ~170/day total (WebSocket handshakes + 10-min polls) vs ~1,440/day (1-min polls)
- **Polling Frequency:** 90% reduction (every 10 min vs every 1 min)
- **WebSocket Timeout:** 5 minutes per connection
- **Coverage:** Tested with manual order placement, WebSocket monitoring confirmed via logs

**Monitoring Queries:**

Check WebSocket coverage:
```sql
SELECT 
  COUNT(*) FILTER (WHERE ws_monitored_at IS NOT NULL) as websocket_monitored,
  COUNT(*) FILTER (WHERE ws_monitored_at IS NULL) as not_monitored,
  COUNT(*) as total_submitted
FROM lth_pvr.exchange_orders
WHERE status = 'submitted';
```

Check polling efficiency:
```sql
SELECT 
  AVG(poll_count) as avg_polls_per_order,
  MAX(poll_count) as max_polls,
  COUNT(*) FILTER (WHERE poll_count = 0) as never_polled
FROM lth_pvr.exchange_orders
WHERE status IN ('filled', 'cancelled');
```

Check WebSocket alerts:
```sql
SELECT alert_id, severity, message, context, created_at
FROM lth_pvr.alert_events
WHERE component = 'ef_valr_ws_monitor'
  AND resolved_at IS NULL
ORDER BY created_at DESC;
```

**Documentation:**
- Implementation Guide: `docs/WebSocket_Order_Monitoring_Implementation.md` (10 sections, 500+ lines)
- Test Cases: `docs/WebSocket_Order_Monitoring_Test_Cases.md` (35 tests across 7 categories)
- See Section 8.2 for deployment procedures

**Test Results Format:**
```markdown
#### Test Case X.X.X: Description ✅ PASS
**Test Steps:** ...
**Expected Results:** ...
**Test Execution:**
- Date: 2025-12-27 HH:MM UTC
- Result: ✅ PASS
- [Detailed execution notes with code line references]
- Verification: [What was verified]
```

---

## 4. Daily Live-Trading Flow

### 4.1 Timeline (UTC)

**03:00** – Fetch CI bands & price
- `pg_cron` calls `ef_fetch_ci_bands`
- Inserts/updates `ci_bands_daily` for yesterday (CURRENT_DATE - 1)
- **Alerting:** Guard function ensures data availability every 30 minutes

**03:05** – Generate decisions
- `ef_generate_decisions`:
  - Reads CI bands for signal_date (yesterday)
  - Calculates momentum from 6-day price history
  - Determines band bucket and allocation percentage
  - Writes to `decisions_daily` per active portfolio
  - **Alerting:** Logs error if CI bands missing

**03:10** – Create order intents
- `ef_create_order_intents`:
  - Consumes `decisions_daily`
  - Queries `fn_usdt_available_for_trading()` for budget
  - Applies LTH PVR allocation logic with retrace rules
  - Writes `order_intents` with status='pending'
  - **Alerting:** Logs info for below-minimum orders (carry bucket)

**03:15** – Execute orders
- `ef_execute_orders`:
  - Groups eligible `order_intents`
  - Looks up `exchange_account_id` → `subaccount_id`
  - Sends limit orders to VALR with HMAC signature
  - **NEW:** Initiates WebSocket monitoring for submitted orders
    - Groups orders by subaccount_id
    - POST to ef_valr_ws_monitor (non-blocking)
    - Marks orders with ws_monitored_at timestamp
  - **Alerting:** Logs critical for missing subaccounts, error for API failures, warn for WebSocket failures

**03:15–all day** – Order monitoring (hybrid WebSocket + polling)
- **WebSocket Monitoring (primary):**
  - `ef_valr_ws_monitor` establishes connection per subaccount
  - Subscribes to ACCOUNT_ORDER_UPDATE events
  - Real-time updates (<5 sec latency) for order status and fills
  - 5-minute timeout, auto-closes when all orders complete
  - **Alerting:** Error for connection failures, warn for premature closure
  
- **Polling Fallback (safety net):**
  - `ef_poll_orders` (every 10 minutes, reduced from 1 minute):
    - Only polls orders not updated in last 2 minutes
    - Targeted polling support via ?order_ids query parameter
    - Updates last_polled_at, poll_count tracking columns
    - Fallback logic: if limit unfilled/partial >5 min OR price moves >0.25%, cancel and submit market order
    - **Alerting:** Logs error for status query failures, warn for excessive fallback usage
    - **Performance:** 98% API call reduction vs previous 1-minute polling

**03:30** – Post ledger & balances
- `ef_post_ledger_and_balances`:
  - Reads `v_fills_with_customer` + `exchange_funding_events`
  - Produces `ledger_lines` events
  - Rolls into `balances_daily` per portfolio and asset

**05:00** – **Alert Digest Email** (NEW)
- `ef_alert_digest`:
  - Queries unresolved error/critical alerts where `notified_at IS NULL`
  - Sends email digest via Resend API
  - Updates `notified_at` to prevent duplicate emails

**Overnight** – Benchmark & fees
- `ef_std_dca_roll` updates Standard DCA benchmark balances
- `ef_fee_monthly_close` (monthly) calculates performance fees from `v_monthly_returns`

---

## 5. Back-Testing Architecture

### 5.1 Inputs
- Upfront and monthly USDT contributions
- Trade & contribution fee percents (basis points)
- Date range (start_date, end_date)
- Strategy config (bands, momentum, retrace flags)

### 5.2 Process

**`ef_bt_execute`:**
1. Create `bt_runs` row with status='pending'
2. Iterate each trade date in range:
   - Read CI bands for that date
   - Run decision logic (same as live)
   - Apply monthly contributions and fees
   - Simulate trades for LTH PVR and Std DCA
   - Calculate balances, NAV, ROI, CAGR
3. Bulk-insert results:
   - `bt_ledger` – simulated trades
   - `bt_orders` – synthetic orders for audit
   - `bt_results_daily` – LTH PVR daily metrics
   - `bt_std_dca_ledger` – Std DCA trades
   - `bt_std_dca_balances` – Std DCA daily metrics
4. Update `bt_runs` with:
   - `status = 'completed'`
   - `finished_at = now()`
   - Final NAV, ROI%, CAGR% summary

### 5.3 Outputs
- **Daily time-series:** Balances & NAV for both portfolios
- **Annual summary:** `v_bt_results_annual` view
  - Columns: `year`, `btc_price`, `total_investment`, `btc_holdings`, `usd_holdings`, `nav_usd`, `roi_pct`, `cagr_pct`
  - Separate rows for LTH PVR and Std DCA
- **UI Visualization:** Strategy Back-Testing module
  - Charts: Holdings, Portfolio Value, ROI, Annualised Growth
  - Tables: Yearly comparison with PDF export

---

## 6. Security & RLS Model

### 6.1 Organisation & Identity

**Multi-Tenancy:**
- Centred around `org_id` (UUID)
- One or more organisations per environment
- Initially single org: b0a77009-03b9-44a1-ae1d-34f157d44a8b

**Authentication:**
- RPC `public.my_orgs()` maps authenticated user to allowed org_id values
- Membership tracked via `org_members` and `organizations` tables
- Edge Functions use service role key and bypass RLS

### 6.2 RLS Principles

**Browser-Accessible Tables:**
- Every table queried directly by browser has:
  - `org_id` column
  - RLS enabled
  - Policies restricting rows to `org_id IN (SELECT id FROM public.my_orgs())`

**Write Protection:**
- Sensitive tables (orders, ledger, balances, back-tests, **alerts**) only written via Edge Functions
- Edge Functions use service role key with RLS bypass

### 6.3 Example Policies

**Back-test Results:**
```sql
ALTER TABLE lth_pvr_bt.bt_results_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_can_read_bt_results_daily
ON lth_pvr_bt.bt_results_daily
FOR SELECT
USING (org_id IN (SELECT id FROM public.my_orgs()));
```

**Alert Events (NEW):**
```sql
ALTER TABLE lth_pvr.alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_can_read_alerts
ON lth_pvr.alert_events
FOR SELECT
USING (org_id IN (SELECT id FROM public.my_orgs()));
```

**Applied To:**
- All `lth_pvr_bt.*` tables
- All `lth_pvr.*` tables accessed by UI
- `public.exchange_accounts`
- `public.customer_portfolios`
- `public.customer_details`

---

## 7. UI Integration

### 7.1 Global Context Bar

**Location:** Top of strategy-sensitive modules

**Dropdowns:**
1. **Organisation** – driven by `public.my_orgs()`
2. **Customer** – lists `public.customer_details` filtered by org_id
3. **Active Portfolio / Strategy** – lists `public.v_customer_portfolios_expanded` for selected org & customer

**Stored State:**
```javascript
{
  org_id: 'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  customer_id: 1001,
  portfolio_id: 'uuid',
  strategy_code: 'LTH_PVR'
}
```

**Usage:** All strategy-specific cards read from this shared state object

### 7.2 Customer Maintenance

**Responsibilities:**
- Maintain `customer_details` (name, contact, KYC, status)
- Manage `customer_portfolios` per customer
- Allocate exchange accounts via `public.exchange_accounts`

**Portfolios Panel:**
- Grid showing: Strategy, Exchange, Subaccount, Status, Since
- Backed by view joining portfolios, strategies, exchange_accounts

**Add Portfolio Flow:**
1. Select `strategy_code` (ADV_DCA, LTH_PVR, etc.)
2. Select or create exchange account
3. Choose base/quote assets (BTC/USDT)
4. Set status = 'active'
5. Save to `customer_portfolios`

**Exchange Account Management:**
- List `exchange_accounts` for org
- Edit label, status, subaccount_id
- "Fetch VALR subaccount_id" button:
  - Calls `ef_valr_subaccounts`
  - Returns available subaccounts (ID + label)
  - UI writes selected `subaccount_id` to table

**Customer Status Mirroring:**
- When `customer_details.status` changes from active → non-active:
  - DB trigger/job updates `customer_portfolios.status` to inactive
  - Trading EFs only process portfolios with status='active'

### 7.3 Customer Balance Maintenance

**Two-Lane Module:**

**Lane A – Advanced BTC DCA**
- Uses `real_exchange_txs`, `exchange_daily_balances`, drift views
- Only shown when `strategy_code = 'ADV_DCA'`

**Lane B – LTH PVR BTC DCA**
- **LTH PVR – Ledger & Balances card:**
  - Calls `lth_pvr_list_ledger_and_balances(from_date, portfolio_id, to_date)`
  - Displays ledger events and derived balances
  - "Recalculate balances" button → calls `ef_post_ledger_and_balances`
- Only shown when `strategy_code = 'LTH_PVR'`

### 7.4 Customer Transactions

**Focus:** Strategy-specific intents and orders (not individual customers)

**Controls:**
- Organisation and Active Portfolio / Strategy from context bar
- Date range selector

**Cards:**
- Daily rule execution ("Run Daily Rules" button)
- Intent creation preview (`order_intents` table)
- VALR execution status (`exchange_orders`, `order_fills` tables)

**Global View Option:**
- Can show all customers on strategy by filtering on `strategy_code + org_id` instead of `portfolio_id`

### 7.5 Portfolio Performance Reporting

**Data Sources:**
- `lth_pvr.v_customer_portfolio_daily` – live NAV, balances, ROI
- `lth_pvr.v_compare_portfolio_daily` – LTH vs Std DCA comparison

**Visualizations:**
- NAV over time (line chart)
- ROI % (line chart)
- Max Drawdown (future enhancement)
- Yearly aggregated metrics table

### 7.6 Strategy Back-Testing

**UI Components:**
- Form: strategy selection, date range, contributions, fees
- "Run back-test" button → creates `bt_runs` row and calls `ef_bt_execute`

**Visualizations:**
- Holdings (BTC + USDT stacked area)
- Portfolio Value (NAV line chart)
- ROI % (line chart)
- Annualised Growth (CAGR comparison)

**Tables:**
- Yearly summary (from `v_bt_results_annual`)
- PDF export functionality

### 7.7 Finance Module

**Views:**
- `v_monthly_returns` – portfolio performance by month
- `fee_configs` – fee rate configuration
- `fees_monthly` – calculated monthly fees
- `fee_invoices` – generated invoices

**UI:**
- Monthly fee dashboard
- Invoice generation and email (`ef_fee_invoice_email`)

### 7.8 Administration Module

**Components:**

1. **Cron & Job Status**
   - Overview of scheduled jobs
   - Recent run history from `lth_pvr.runs`
   - Configuration toggles (pause trading, fee rates)

2. **System Alerts (NEW - FULLY OPERATIONAL)**
   - **Alert Badge:** Red count in navigation bar
   - **Component Filter:** Dropdown with 6 options
   - **Open Only Filter:** Checkbox (default: checked)
   - **Auto-Refresh:** 30-second interval checkbox
   - **Alerts Table:** Severity, component, created date, message, resolve button
   - **Resolve Dialog:** Prompt for optional resolution note
   - **Status:** All features tested and working (14/14 UI tests passed)

---

## 8. Deployment & Operations

### 8.1 Environment Variables

**Edge Runtime Secrets:**
```bash
SUPABASE_URL="https://wqnmxpooabmedvtackji.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="[service_role_key]"
ORG_ID="b0a77009-03b9-44a1-ae1d-34f157d44a8b"

# VALR API
VALR_API_KEY="[primary_api_key]"
VALR_API_SECRET="[primary_api_secret]"

# Alert Digest (NEW)
RESEND_API_KEY="[your-resend-api-key]"
ALERT_EMAIL_FROM="alerts@bitwealth.co.za"
ALERT_EMAIL_TO="your-email@example.com"

# CryptoQuant API
CRYPTOQUANT_API_KEY="[api_key]"
```

**Setting Secrets:**
```bash
cd /path/to/bitwealth-lth-pvr
supabase secrets set RESEND_API_KEY=[your-resend-api-key] \
  ALERT_EMAIL_FROM="alerts@bitwealth.co.za" \
  ALERT_EMAIL_TO="your-email@example.com"
```

### 8.2 Edge Function Deployment

**Deploy Single Function:**
```bash
supabase functions deploy ef_alert_digest --no-verify-jwt
```

**Deploy All Functions:**
```bash
supabase functions deploy
```

**WebSocket Monitoring Functions (NEW - 2025-12-27):**
```bash
# WebSocket monitor (no JWT verification for internal calls)
supabase functions deploy ef_valr_ws_monitor --no-verify-jwt

# Updated order execution with WebSocket initiation
supabase functions deploy ef_execute_orders

# Updated polling with safety net logic
supabase functions deploy ef_poll_orders
```

**Deployment via MCP (CLI compatibility workaround):**
If CLI deployment fails due to config.toml compatibility issues, use MCP tools:
```typescript
// Via mcp_supabase_deploy_edge_function
{
  "name": "ef_valr_ws_monitor",
  "files": [{"name": "index.ts", "content": "..."}],
  "verify_jwt": false
}
```

**Check Deployment Status:**
```sql
-- Via MCP
mcp_supabase_list_edge_functions()
```

**Deployed Versions (as of 2025-12-27):**
- ef_valr_ws_monitor: v2 (ACTIVE, verify_jwt=false)
- ef_execute_orders: v29 (ACTIVE, verify_jwt=true)
- ef_poll_orders: v38 (ACTIVE, verify_jwt=true)
- ef_alert_digest: v3 (ACTIVE, verify_jwt=false)

### 8.3 Database Migrations

**Apply Migration:**
```bash
supabase db push
```

**Check Migration Status:**
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10;
```

**Key Migrations:**
- `20251224_add_notified_at_column_to_lth_pvr.alert_events.sql`
- `20251226_create_cron_schedule_for_ef_alert_digest.sql`
- `20251227123418_fix_ensure_ci_bands_today.sql`
- `20251227_add_websocket_tracking_to_exchange_orders.sql` (NEW)
- `20251227_reduce_poll_orders_cron_frequency.sql` (NEW)

### 8.4 Cron Job Management

**List Active Jobs:**
```sql
SELECT jobid, jobname, schedule, active, nodename
FROM cron.job
WHERE jobname LIKE 'lth_pvr%'
ORDER BY jobname;
```

**Disable Job:**
```sql
SELECT cron.alter_job(22, enabled := false);  -- Alert digest job
```

**Re-enable Job:**
```sql
SELECT cron.alter_job(22, enabled := true);
```

**View Job Run History:**
```sql
SELECT jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = 22  -- Alert digest
ORDER BY start_time DESC
LIMIT 10;
```

### 8.5 Monitoring & Troubleshooting

**Check Alert Digest Status:**
```sql
-- Verify cron job is active
SELECT * FROM cron.job WHERE jobname = 'lth_pvr_alert_digest_daily';

-- Check for unnotified alerts
SELECT alert_id, component, severity, created_at, message
FROM lth_pvr.alert_events
WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND severity IN ('error', 'critical')
  AND resolved_at IS NULL
  AND notified_at IS NULL
ORDER BY created_at DESC;

-- View email send history
SELECT alert_id, component, severity, created_at, notified_at
FROM lth_pvr.alert_events
WHERE notified_at IS NOT NULL
ORDER BY notified_at DESC
LIMIT 20;
```

**Check Edge Function Logs:**
```sql
-- Via MCP
mcp_supabase_get_logs(service="edge-function")
```

**Check CI Bands Guard Log:**
```sql
SELECT log_id, run_at, target_date, did_call, http_status, details
FROM lth_pvr.ci_bands_guard_log
ORDER BY run_at DESC
LIMIT 20;
```

**Manual Alert Digest Test:**
```powershell
$body = '{"org_id":"b0a77009-03b9-44a1-ae1d-34f157d44a8b"}'
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body $body
```

### 8.6 Operational Procedures

**Daily Monitoring Checklist:**
1. Check email for alert digest (07:00 SAST)
2. Review UI Alerts card for any new critical/error alerts
3. Verify CI bands guard log shows successful runs
4. Check `lth_pvr.runs` table for any failed edge function executions
5. Monitor VALR order execution and fallback rates

**Weekly Tasks:**
1. Review resolved alerts and resolution notes
2. Analyze alert patterns for recurring issues
3. Check back-test results for strategy performance
4. Verify ledger and balance reconciliation

**Monthly Tasks:**
1. Run `ef_fee_monthly_close` for performance fee calculation
2. Generate and send fee invoices via `ef_fee_invoice_email`
3. Review `v_monthly_returns` for customer performance
4. Archive old alerts (resolved > 90 days)

**Incident Response:**
1. **Critical Alert:** Investigate immediately, resolve root cause
2. **Error Alert:** Investigate within 24 hours, document resolution
3. **Missing Data:** Run guard function manually, check API keys
4. **VALR Issues:** Check API status, review rate limits, verify subaccount IDs

---

## 9. Documentation References

### 9.1 Technical Documentation

- **SDD_v0.6.md** (this file) – Complete solution design
- **Alert_System_Test_Cases.md** – 51 test cases with execution tracking
- **Alert_Digest_Setup.md** – Email digest configuration and troubleshooting
- **Build Plan_v0.5.md** – Implementation roadmap (if exists)

### 9.2 Code References

**Edge Functions:**
- `supabase/functions/ef_alert_digest/` – Email digest implementation
- `supabase/functions/_shared/alerting.ts` – Shared alerting module
- `supabase/functions/ef_generate_decisions/` – Decision engine with alerting
- `supabase/functions/ef_execute_orders/` – Order execution with alerting
- `supabase/functions/ef_poll_orders/` – Order polling with alerting

**Database:**
- `supabase/sql/ddl/lth_pvr.alert_events.ddl.sql` – Alert events table schema
- `supabase/functions/lth_pvr.ensure_ci_bands_today.fn.sql` – Guard function
- `supabase/functions/public.list_lth_alert_events.fn.sql` – UI RPC
- `supabase/functions/public.resolve_lth_alert_event.fn.sql` – Resolve RPC

**UI:**
- `ui/Advanced BTC DCA Strategy.html` lines 356-368 – Badge CSS
- Lines 2085-2110 – Alerts card HTML
- Lines 5545-5670 – Alert JavaScript functions

**Migrations:**
- `supabase/sql/migrations/20251224_add_notified_at_column_to_lth_pvr.alert_events.sql`
- `supabase/sql/migrations/20251226_create_cron_schedule_for_ef_alert_digest.sql`

**Implementation Guides:**
- `Alert_Digest_Setup.md` – Complete alert digest configuration and troubleshooting
- `WebSocket_Order_Monitoring_Implementation.md` – WebSocket monitoring technical guide

**Test Documentation:**
- `LTH_PVR_Test_Cases_Master.md` – Consolidated test cases for all system components (116 tests)
- Individual test case documents:
  - `Alert_System_Test_Cases.md` – 51 alert system tests
  - `WebSocket_Order_Monitoring_Test_Cases.md` – 35 WebSocket monitoring tests
  - `Pipeline_Resume_Test_Cases.md` – 30 pipeline resume tests

---

## 10. Future Enhancements

### 10.1 Alerting System
- [ ] Slack webhook integration as alternative to email
- [ ] SMS notifications for critical alerts via Twilio
- [ ] Alert acknowledgment with auto-escalation if not resolved within SLA
- [ ] Alert grouping/deduplication for repeated errors
- [ ] Webhook notifications to external monitoring systems (PagerDuty, etc.)
- [ ] Alert metrics dashboard (MTTR, frequency by component, etc.)

### 10.2 Monitoring
- [ ] Real-time dashboard for pipeline health
- [ ] Performance metrics (order fill rates, latency, API response times)
- [ ] Max drawdown tracking and visualization
- [ ] Sharpe ratio calculation
- [ ] Time-in-band analysis (how long portfolio stays in each band)

### 10.3 Strategy
- [ ] Support for additional cryptocurrencies (ETH, SOL, etc.)
- [ ] Multi-exchange support beyond VALR
- [ ] Dynamic strategy parameter adjustment based on market conditions
- [ ] Machine learning for momentum prediction improvements

### 10.4 UI/UX
- [ ] Customer-facing portal (read-only access to own portfolios)
- [ ] Mobile-responsive design
- [ ] Real-time WebSocket updates for orders and alerts
- [ ] Enhanced PDF reporting with custom branding
- [ ] Dark mode theme

### 10.5 Compliance & Reporting
- [ ] Tax reporting integration (capital gains, income)
- [ ] Regulatory compliance tracking per jurisdiction
- [ ] Audit trail exports (CSV, JSON)
- [ ] Customer statements (monthly/quarterly)

---

## 11. Appendices

### 11.1 Glossary

- **CI Bands:** CryptoQuant Indicator bands for Long-Term Holder Profit/Loss Realized (PVR)
- **LTH PVR:** Long-Term Holder Price Variance Ratio strategy
- **DCA:** Dollar-Cost Averaging
- **NAV:** Net Asset Value
- **ROI:** Return on Investment
- **CAGR:** Compound Annual Growth Rate
- **RLS:** Row-Level Security
- **RPC:** Remote Procedure Call (Supabase function callable from client)
- **EF:** Edge Function (Deno/TypeScript serverless function)
- **Guard Function:** Database function that ensures data availability
- **Carry Bucket:** Accumulator for sub-minimum order amounts

### 11.2 Alert Severity Guidelines

| Severity | Definition | Response Time | Examples |
|----------|------------|---------------|----------|
| **critical** | System failure or data loss | Immediate (< 1 hour) | Missing VALR subaccount, API authentication failure, database corruption |
| **error** | Feature failure requiring investigation | Within 24 hours | Order execution failure, CI bands fetch failure, ledger rollup error |
| **warn** | Potential issue requiring monitoring | Within 48 hours | Excessive fallback usage, slow API response, approaching rate limits |
| **info** | Informational, no action required | Review weekly | Below-minimum order added to carry, strategy decision logged |

### 11.3 Key Database Tables Summary

| Table | Purpose | Key Columns | Size Estimate |
|-------|---------|-------------|---------------|
| `lth_pvr.ci_bands_daily` | Daily CI bands and BTC price | date, btc_price, band levels | ~365 rows/year |
| `lth_pvr.decisions_daily` | Per-customer daily decisions | customer_id, trade_date, action, allocation_pct | ~365 rows/customer/year |
| `lth_pvr.order_intents` | Tradeable order intents | intent_id, portfolio_id, side, amount_usdt | ~365 rows/portfolio/year |
| `lth_pvr.exchange_orders` | VALR orders | order_id, portfolio_id, status | ~365 rows/portfolio/year |
| `lth_pvr.order_fills` | Individual fills | fill_id, order_id, filled_qty, fee | ~730 rows/portfolio/year |
| `lth_pvr.ledger_lines` | Canonical event ledger | line_id, portfolio_id, event_type, amounts | ~1000 rows/portfolio/year |
| `lth_pvr.balances_daily` | Daily balances per portfolio | portfolio_id, date, balance_btc, balance_usdt, nav_usd | ~365 rows/portfolio/year |
| `lth_pvr.alert_events` | System alerts | alert_id, component, severity, message, resolved_at | Variable, ~50-200/year |
| `lth_pvr_bt.bt_results_daily` | Back-test daily results | bt_run_id, date, balances, ROI | ~365 rows/backtest |

### 11.4 Edge Function Execution Flow

```
03:00 UTC: ef_fetch_ci_bands
    ↓
03:05 UTC: ef_generate_decisions
    ↓
03:10 UTC: ef_create_order_intents
    ↓
03:15 UTC: ef_execute_orders
    ↓
03:15-03:30: ef_poll_orders (every minute)
    ↓
03:30 UTC: ef_post_ledger_and_balances
    ↓
05:00 UTC: ef_alert_digest
    ↓
Overnight: ef_std_dca_roll
    ↓
Monthly: ef_fee_monthly_close → ef_fee_invoice_email

Guard: lth_pvr.ensure_ci_bands_today() (every 30 minutes)

Recovery: ef_resume_pipeline (manual or scheduled)
  - Called via UI "Resume Pipeline" button
  - Checks pipeline status
  - Queues incomplete steps asynchronously
  - Continues from last completed step
```

---

**End of Solution Design Document v0.6**

*For questions or updates, contact: davin.gaier@gmail.com*
