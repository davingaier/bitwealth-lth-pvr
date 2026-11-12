# BitWealth LTH PVR - AI Agent Instructions

## Project Overview

**BitWealth LTH PVR** is a Bitcoin Dollar-Cost Averaging (DCA) service using the **Long-Term Holder Price Variance Ratio (LTH PVR)** strategy. The system automates daily BTC buy/sell decisions, executes orders via VALR exchange, tracks performance, and compares results against standard DCA benchmarks.

- **Stack:** Supabase PostgreSQL + Deno Edge Functions + vanilla HTML/JS admin UI
- **Exchange:** VALR (South African crypto exchange) with HMAC authentication and subaccount routing
- **Architecture:** Event-driven daily pipeline orchestrated via `pg_cron`, with automated alerting and recovery mechanisms

## Critical Architectural Patterns

### 1. Daily Pipeline Execution (00:05-17:00 UTC)

The system runs a **6-step sequential pipeline** every trading day. As of
2026-05-19 (CI→RB migration Day 7), the live pipeline reads **Research Bitcoin
(RB)** bands by default. The legacy CryptoQuant (CI) band data is frozen and
retained only for historical back-test reproducibility.

1. **RB Bands Fetch** (`ef_fetch_rb_bands`) - 00:05 UTC
   - Fetches on-chain LTH PVR inputs from Research Bitcoin API and computes bands locally (hybrid CI-seeded constants + Welford online std-dev)
   - Stored in `lth_pvr.rb_bands_daily`
   - Token managed in `lth_pvr.rb_api_token`, renewed daily at 00:03 UTC by `ef_renew_rb_token`
   - **Guard mechanism:** `lth_pvr.ensure_rb_bands_today()` runs every 30 min to retry if missing
   - **Pipeline chain:** On success, fires `ef_resume_pipeline` so steps 2-6 run immediately

2. **Generate Decisions** (`ef_generate_decisions`) - 00:10 UTC (morning cron) or chained from step 1
   - Compares BTC price to RB bands to determine buy/sell/hold
   - Applies momentum filters and retrace logic
   - Creates records in `lth_pvr.decisions_daily` with `band_source='rb'`

3. **Create Order Intents** (`ef_create_order_intents`)
   - Sizes orders based on decisions and available capital
   - Writes to `lth_pvr.order_intents`

4. **Execute Orders** (`ef_execute_orders`)
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
- If step 1 fails (RB bands unavailable), the 30-min RB guard cron retries until success and then chains the pipeline.
- `lth_pvr.get_pipeline_status()` - Checks completion state of all 6 steps
- `ef_resume_pipeline` - Sequential orchestrator that resumes from incomplete steps
- UI: Administration module → Pipeline Control Panel with status checkboxes and Resume button
- **Key Fix (2025-12-28):** Sequential execution via `await fetch()` replaced async `pg_net` queuing to prevent race conditions

**Band-source parameter (CI→RB migration, complete 2026-05-19):**
- All pipeline / statement / fee / back-tester EFs accept an optional `band_source` (`'rb'` | `'ci'`) in the request body. Default is `'rb'`.
- Override is only useful for back-fills against historical CI data; live trading never overrides.
- Shared helper: `supabase/functions/_shared/band_source.ts` (`BandSource`, `bandsTableForSource`, `normaliseBandSource`, `readBandSourceFromBody`).

### 2. Supabase Schema Organization

**Three schemas with distinct purposes:**

- **`public`** - Shared multi-tenant entities
  - `customer_details`, `customer_portfolios`, `organizations`, `org_members`
  - `exchange_accounts` - Single source of truth for VALR credentials/subaccounts
  - `strategies` - Catalog of strategy types (LTH_PVR, ADV_DCA, etc.)

- **`lth_pvr`** - Live trading operations
  - Decision tables: `rb_bands_daily` (primary), `ci_bands_daily` (frozen historical reference, no longer fetched), `decisions_daily` (records `band_source` per row), `order_intents`
  - RB infra: `rb_bands_state` (Welford running stats), `rb_api_token`
  - Exchange integration: `exchange_orders`, `order_fills`
  - Accounting: `ledger_lines`, `balances_daily`, `customer_state_daily`
  - Monitoring: `rb_bands_guard_log`, `ci_bands_guard_log` (legacy, kept for audit) — note: `alert_events` lives in `public` since 2026-05-02 (strategy-agnostic)
  - Benchmark: `std_dca_balances_daily`, `std_dca_ledger`

- **`lth_pvr_bt`** - Back-testing (isolated from live data)
  - `bt_runs`, `bt_results_daily`, `bt_std_dca_balances`

- **`sth_cb` / `sth_cb_bt`** - STH Cost Basis strategy (`STH_CB`, added 2026-10-24; **live pipeline wired 2026-11-04** — see the Live pipeline bullet below)
  - `sth_cb.cost_basis_daily` is a **view** over `lth_pvr.onchain_pvr_daily` (STH cost basis = RB `realized_price_sth`) — do not add a second fetcher
  - `sth_cb_bt.bt_runs / bt_params / bt_results_daily / bt_ledger / bt_std_dca_* / bt_hodl_* / v_bt_results_annual` mirror `lth_pvr_bt` column names so UI chart code is shared
  - Security posture like `ta_bot`: RLS on, no policies, service-role only; browser reads via `public.sth_cb_bt_*` SECURITY DEFINER RPCs guarded by `my_orgs()`
  - Both schemas must stay in PostgREST **Exposed schemas** or `ef_sth_cb_bt_execute` fails with `PGRST106 Invalid schema`
  - Rules engine: `_shared/sth_cb_strategy_logic.ts` (`decideSthCb`) — any future live decision EF must import it
  - Simulator: `_shared/sth_cb_simulator.ts` (pure, DB-free) is the single accounting implementation for `ef_sth_cb_bt_execute` AND the local lab `tools/sth_cb_lab/` (Deno; `fetch.ts` → `run.ts` / `optimize.ts`). Experiment locally first; promote winners via `bt_params.extras` (jsonb of `SthCbConfig` flags) — new refinement ideas must NOT add columns/tables
  - **`band_source='sth_cb'`** (2026-10-25): a third band source for the *LTH PVR engine* — mean = STH cost basis, ±σ per `_shared/sth_cb_bands.ts`; rows in `lth_pvr.sth_cb_bands_daily` (recomputed daily by `ef_fetch_onchain_pvr` via `_shared/sth_cb_bands_db.ts`, definition in `lth_pvr.sth_cb_band_params`); view `lth_pvr_bt.v_backtest_prices_sth_cb`. Optimised in `tools/sth_cb_lab/lth_optimize.ts`; ceiling ≈ 2× HODL on a lump sum (see README Part 2) — experimental only
  - **STH_CB hybrid v1** (2026-10-25): best STH_CB config found by autonomous iteration (ideas 1–14, flags in `extras`) — 272 684 % ROI / 32.7× HODL on $1k lump 2017→2026 with full fees, WF 7/10; JSON + robustness table in `tools/sth_cb_lab/README.md`. Re-run `robustness.ts` before trusting any new winner
  - **STH_CB hybrid v2** (2026-10-26): v1 + momentum-gated scale-out ladder at LTH PVR +1/1.5/2/2.5σ (75/50/25/0 % BTC, idea 15 `lthSellTiers`/`lthSellMomoGate`) + dip re-buy (idea 16 `dipRebuyPct`/`dipRebuyAtCbRatio`/`dipRebuyMax`) + `scaleCooldownDays:5` — 380 110 % / 45.6× HODL, WF 8/10, beats v1 on every robustness row. Ladders without the momentum gate lose to a single all-out
  - **STH_CB hybrid v2.1** (2026-10-27): v2 with slice sizes optimised by `tools/sth_cb_lab/ladder_optimize.ts` (full 1-dp enumeration) — ladder **30/20/10/0 %**. **Re-buy knobs corrected 2026-11-03** after fixing a same-tick R15 slice / R16 re-buy cancellation bug (`slicedThisTick` guard): now `dipRebuyAtCbRatio 1.05, dipRebuyMax 1, scaleCooldownDays 2` → 402 578 % / 48.3× HODL, 52 trades, DD 42 %, WF 8/10. Small sells at the LTH mean / +0.5σ were tested and *hurt*. Note: `optimize.ts`'s evaluated-config key used to strip nested tier objects (fixed via `configKey()`); never key configs with `JSON.stringify(c, keysArray)`; `configDiff()` prints removed keys as `key=off`
  - **STH_CB hybrid v2.2** (2026-11-03, current default preset): v2.1 + **no-loss ladder** `sliceAboveLastBuyPct: 0` (a slice only above the last buy/re-buy price; replaces the cooldown) + earlier first rung **50/20/10/0 % at +0.5/1/1.5/2.5σ** → 439 825 % / 52.7× HODL, 61 trades, DD 42 %, WF 8/10; +9–12 % on every horizon of the $2.4k+$200/mo table, table-basis WF 7/11. Rejected (flags kept inert): CB-% ladder rungs (≈ half the NAV of σ rungs), `reentryBelowLastExitPct`, `exitMinGainPct`, `rebuyBelowLastSellPct`. `lthSellTiers` entries may use `cbRatio` instead of `sigma`. Multi-period harness `tools/sth_cb_lab/periods.ts --file candidates.json`; pass configs via JSON files (PowerShell mangles long inline JSON)
  - **Strategy tracker** (2026-10-26): `sth_cb.tracker_config` / `tracker_daily` rebuilt daily by `ef_sth_cb_tracker` (chained from `ef_fetch_onchain_pvr`; service-role auth via `_shared/adminAuth.ts`); shown as the top card of Admin UI → On-Chain Charts with a selector over all active configs (`hybrid_v1`, `hybrid_v2`, `hybrid_v2_1`, `hybrid_v2_2`). To track another config, insert a `tracker_config` row — no code change
  - **⚠️ Price basis = UTC CLOSE since 2026-11-06.** `lth_pvr.onchain_pvr_daily.btc_price` is the Binance BTCUSDT daily close (RB `h1` 23:00 bar pre-2017-08-17); RB's `price/price` at d1 is a daily *average* (≈VWAP) and is kept only in `btc_price_avg_usd`. Published STH_CB figures on closes (before the 4-day gate, see next bullet): **$1k 2017→ = $2.31M, 30.5× HODL, DD 40 %, WF 7/10** (was 52.7× on the averaged series — the smoothing, not the rules, was ~40 % of it; a 20k-config re-fit on closes cannot beat unchanged v2.2). Lab: `fetch_closes.ts` → `data/series_close.json`, `--series close` / `SERIES=close`, `compare_price_source.ts`, `review_diff.ts`, `STHCB_OUT_DIR` to stage generator output. **⚠️ In-sample vs out-of-sample**: every published multiple is in-sample; true OOS (fit 2015–19 → test 2020–26) ≈ **2.1× median / 3.5× top-1** (reverse 1.5×) ≈ ChartInspect's un-optimised rules. All public surfaces show both via `tools/sth_cb_lab/oos_data.ts` → `docs/sth_cb_oos_data.js` + `website/js/sth_cb_oos_data.js` (`window.STHCB_OOS`); regenerate rather than hand-edit. Never quote the in-sample multiple without the OOS one. Lab `--walk-forward` = same params re-run per year (path independence), not an over-fit test
  - **STH_CB v2.2 + 4-day capitulation gate** (2026-11-06, promoted in place — there is NO v2.3 key): v2.2 now includes `capBuyRocLength: 4` (idea 19 — the R1 capitulation confirmation reads a 4-day ROC instead of the 2-day `momoLength`; the 2-day gate can never confirm inside a V-shaped flush: Feb-2026 had 11 closes ≤ 75 % of CB and no buy). \.47M / 32.6× / DD 36 % vs v2.2 \.31M / 30.5× / 40 %; better from every start year and fact-sheet horizon. Tested and **rejected**: armed buy (ideas 17 `capBuyArmDays`/`capBuyArmCeilingRatio` — swaps Feb-2026 for the May-2022 LUNA bounce), split entry (idea 18 `capBuyTouchAlloc` — halves NAV via `minHoldDays` path shifts), re-tuning the 2-day threshold (knife-edge). **2026-11-07 sprint:** v2.2 now also has `momoThreshold: -0.03` (exit gate; −0.02 sat on a cliff edge) and `capBuyRocLength: 3` — smooth 2-D hill, wins every start year, test 2020→ 6.55× → 9.58× (train 2015–19 flat/slightly weaker — a robustness move). A 61.7× compound search result was rejected by the train→test refit (3.68× median) — always refit the search on 2015–19 and score on 2020→ before believing a search. Published figures now **$3.87M / 50.9× / 131 % CAGR / DD 36 % / WF 7/10** ($1k 2017→2026-11-05); `tracker_config.hybrid_v2_2.extras` is the single source of truth (live, public back-tester, tracker) and `HYBRID_V2_2` in `factsheet_data_configs.ts` must mirror it. The strategy is strongly path-dependent — judge any R1 change with `tools/sth_cb_lab/episodes.ts` (per-episode entries) and the start-year table, never by final NAV alone
  - **Public website** (2026-11-03): `website/sth-cb.html` (product page, concepts only — never publish thresholds/σ levels) + `website/sth-cb-backtest.html`. Public runs go `ef_submit_public_backtest {p_strategy:'sth_cb'}` → `public.create_public_sth_cb_backtest_run` (copies `extras` from `sth_cb.tracker_config` `hybrid_v2_2` — the single source of truth) → `ef_sth_cb_bt_execute` → anon poller `get_sth_cb_backtest_results`. `public.backtest_requests.strategy_code` routes recovery (`ef_execute_public_backtests`) and the marketing refresher (`ef_refresh_marketing_charts` → `marketing_chart_data` keys `lth_pvr_5yr` + `sth_cb_5yr`, read via `get_marketing_chart(key)`)
  - **Live pipeline** (2026-11-04): the state machine runs once per org in `ef_sth_cb_tracker` (~02:05 UTC, chained from `ef_fetch_onchain_pvr`); `sth_cb.tracker_daily.signal_target_alloc` = decision at this close, executed next day (`target_alloc` = after today's fill). Per-client translation is the pure `_shared/sth_cb_live.ts` `planCustomerDecision` (BUY pct of cash / SELL pct of BTC; partial slices gated by the client's **own** last buy; `join_policy` `immediate` (Policy A, default) | `next_signal`) → `ef_sth_cb_generate_decisions` (service-role; `{dry_run, customer_ids, trade_date}`) upserts **`sth_cb.decisions_daily`** and chains `ef_create_order_intents {customer_ids}` (which reads BOTH `lth_pvr.decisions_daily` and `sth_cb.decisions_daily`) → execute → poll. Status: `sth_cb.get_pipeline_status` / `sth_cb.get_customer_pipeline_status` (browser wrappers `public.sth_cb_*_pipeline_status`), `ef_resume_pipeline {strategy:'sth_cb'[, check_status]}`, guard cron `sth_cb_pipeline_guard`. **Schema rule (option A):** strategy layer (decisions, signal state, status RPCs) lives in the strategy schema; `lth_pvr.order_intents / exchange_orders / order_fills / ledger_lines / balances_daily / fees / USDPC` are the shared execution engine for every strategy. **Every** "LTH_PVR only" gate must admit STH_CB (`IN ('LTH_PVR','STH_CB')`); only bear-pause admin functions and `ef_generate_decisions` stay LTH-only. `customer_strategies.config_key` FK → `sth_cb.tracker_config` (default `hybrid_v2_2`). **Strategy switch** = `public.switch_customer_strategy` (in place, same exchange account; audit in `public.customer_strategy_history`; Admin UI Edit Client → Switch strategy). Portal state via `public.get_customer_strategy_state`. `ef_create_order_intents` skips decisions whose intent already exists today; USDPC pre-buy converts the whole balance on all-in buys (VALR min 1 USDPC)
  - **MSTR overlay** (2026-11-05, research only): `tools/sth_cb_lab/fetch_mstr.ts` (Yahoo chart API, any `--symbol`) + `mstr_overlay.ts` replay the BTC-decided `signal_target_alloc` on MSTR (VALR `MSTRXUSDT`, thin: ≈1 % spread, max 56 sh / 7,500 USDT per order). 2020-08-11→: 35× MSTR HODL, 4.4× the BTC strategy, DD −52 % vs −25 %; corr ≈ 0.5, beta 1.1–1.4; see README Part 3 before building anything on it
  - **Emails** (2026-11-04): strategy-aware routing via `_shared/strategyEmail.ts` — `templateKeyFor(base, code)` picks the `_sth_cb` variant (welcome, subsequent deposit, KYC verified, monthly statement); `sthCbStateCopy` produces the state-dependent "what happens next" box; `sthCbReason`/`sthCbActionCopy` word position changes without exposing thresholds. Strategy switches go through **`ef_switch_strategy`** (RPC + `strategy_switch_confirmation` + admin notice); `ef_sth_cb_generate_decisions` sends `sth_cb_position_change` per BUY/SELL — **once per customer per trade_date** (`decisions_daily.notified_at`), never for an order that errored and never for a daily retry of an unexecuted decision (`notify_skipped` = already_notified | order_error | retry | no_email; ops alerts instead). Manual tracker / backfill runs chain the live step, so idempotency here is what protects clients from duplicate mail. New templates are built from the live shell in SQL (`pg_temp.tpl_wrap` pattern in `20261104_sth_cb_email_templates.sql`) — never paste the base64 logo into migrations. **Email header** (2026-11-05): solid navy `#032C48` band (`class="bw-hdr"`, `bgcolor`) with the single hosted on-dark logo `<img class="bw-logo">` from the public `branding` bucket — no light/dark swap (Outlook dark mode can reveal but never hide an image; Gmail ignores dark-mode CSS and `data:` images). Bulk template edits go through `tools/email_header_navy.py`-style string slicing, never `regexp_replace` over whole bodies. VALR subaccount labels are strategy-agnostic ("{name} {surname}"); VALR has no rename API
  - **Back-tester joining rule**: simulator honours `extras.joinPolicy` (`immediate` = Policy A default, `next_signal`) and deploys contributions at partial ladder allocations, matching the live engine
  - **USDPC/USDT conversions** (2026-11-07): the pair is a thin, intermittent market-maker quote (bid ≈ mark − 0.3 %, typically ≤ 30k deep, often empty at weekends) with a 1.5 % slippage band and 46,000-base / 10,000-quote per-order caps; LIMIT sells never fill (tested). `ef_execute_orders` sells in depth-sized MARKET chunks (`USDPC_MAX_SLIPPAGE` env, default 1 % of `markPrice`), leaves the intent `pending` with the remainder, and budgets the dependent BTC buy to live USDT (partial buys keep the intent pending; one customerOrderId per attempt `intent-rN` / `intent-cN`). Cron `usdpc_conversion_retry` (*/10 3-16 UTC) re-drives execution; `ef_sweep_usdt_to_usdpc` must skip customers with a pending BUY / funding conversion; `ef_poll_orders` books partial-cancelled IOC chunks as fills and never errors a conversion intent.
  - **VALR execution gotchas** (found by the first live trade, 2026-11-04): public market data is `/v1/public/{pair}/...` (`/v1/marketdata/...` needs auth → 403); order status for OPEN orders is `GET /v1/orders/{pair}/orderid/{orderId}` (history/summary routes 400 until completed); cancel is `DELETE /v1/orders/order {orderId|customerOrderId, pair}`; always look orders up by VALR `orderId` (`exchange_orders.ext_order_id`) because the customerOrderId (= intent_id) is reused by a LIMIT and its MARKET replacement. `ef_execute_orders` and `ef_poll_orders` each have a LOCAL `valrClient.ts` copy that must be kept in sync with `_shared/valrClient.ts`. `tools/valr_probe.ps1` (uses `.env` keys) lists/cancels orders on a subaccount for manual intervention

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
- Queries unnotified error/critical alerts from `public.alert_events` (relocated from `lth_pvr` on 2026-05-02; backwards-compat view kept temporarily)
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
- **Supabase keys (since the 2026-11-05 incident):** legacy `anon`/`service_role` JWT keys are DISABLED. Always read keys via `_shared/supabaseKeys.ts` (`getServiceKey()` / `getPublishableKey()`), never `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Server-to-server calls send the `sb_secret` key in the `apikey` header (bearer only if identical); such target functions must be `--no-verify-jwt` and call `requireOrgAdmin`. Deploy with `.\tools\redeploy_all_functions.ps1` (flags in `tools/edge_function_jwt_flags.json`). `.env` lives OUTSIDE the Dropbox-synced repo. **VALR signing:** never add local HMAC code — call `signValrRequest()` from `_shared/valrSign.ts` (RPC `lth_pvr.valr_sign`, secrets in Vault). Withdrawals: new crypto destinations are held as `needs_approval` until allow-listed (`lth_pvr.withdrawal_allowlist`); kill-switch `settings.withdrawals_enabled`. Critical security alerts email immediately. Operator procedures: `docs/SECURITY_RUNBOOK.md`.
- **SECURITY DEFINER functions (incident #2, 2026-11-11):** `public.get_secret` was anon-callable and leaked the secret key from `private.app_secrets`. Rules: never store a key where a SECURITY DEFINER function can return it to `anon`/`authenticated`; every new SECURITY DEFINER function's migration must `revoke execute … from public, anon` unless the public website calls it anonymously (today: `get_marketing_chart`, `get_lth_pvr_marketing_chart`, `get_backtest_results`, `get_sth_cb_backtest_results`, `forecast_lth_pvr_option4`, `request_lth_pvr_historical_annual_results`); admin RPCs callable by `authenticated` must call `public.assert_org_admin()` (or `assert_customer_access(cust_id)` / `assert_partner()`) as their first statement — run `.\tools\with-secrets.ps1 python tools\audit_rpc_guards.py` after adding functions; it must report only the 6 public RPCs (`--apply` guards the rest automatically). Keys live ONLY in Vault: `lth_pvr.call_edge` reads `ef_auth_header`/`ef_base_url` from `vault.decrypted_secrets`; `lth_pvr.settings` and `invoker_logs` must never hold a token. Edge secrets `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY` are platform-injected (CLI cannot set/unset them) — our override is `SB_SECRET_KEY` (highest precedence in `supabaseKeys.ts`). Suspicious pattern in Dashboard → Logs → API: a non-Deno user-agent (e.g. `Python-urllib`) using an `sb_secret_*` key.
- **Balance anchors:** `_shared/balance_anchor.ts` applies ledger lines with `trade_date > anchor_date`; a brand-new customer's anchor is seeded at zero the day *before* inception — never on the first activity day (customer 65, 2026-11-11).
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
- `signal_date`: Day of band data used (trade_date - 1)
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

0. **Windows PowerShell 5.1 strips embedded double quotes from native-exe arguments:** `curl.exe -d '{"a":1}'` arrives as `{a:1}` (invalid JSON) and every edge function silently falls back to defaults (tracker ran ALL configs, marketing refresh did both charts, `from_date` ignored — 2026-11-06). Scripts launched via `tools\with-secrets.ps1 powershell …` run under 5.1. Always send JSON bodies with `--data-binary "@file.json"` or run under `pwsh` (7.x).

0b. **Never probe with a real admin's identity.** `POST /auth/v1/logout` defaults to *global* scope and kills every session of that user (2026-11-06: the Admin UI then got 401 `invalid or expired session` from guarded functions while PostgREST still worked, because the browser's JWT was unexpired but `auth.getUser` found no session). If a test session is unavoidable use `/auth/v1/logout?scope=local`. Diagnostic: `select count(*) from auth.sessions where user_id=…`.

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

**Last Updated:** 2026-11-12 (incident #2 lockdown rules, balance-anchor rule; previously 2026-11-04 STH_CB live pipeline)  
**For detailed architecture, see:** [docs/SDD_v0.6.md](docs/SDD_v0.6.md)
