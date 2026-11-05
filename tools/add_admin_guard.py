"""One-off (2026-11-05 hardening): add a caller check to Edge Functions deployed --no-verify-jwt that had none.

For each listed function: ensure the request handler has a `req` parameter, then insert right after the handler's
opening line (or after its CORS-preflight block when present):

    const __caller = await requireOrgAdminAuto(req);
    if (!__caller.ok) return unauthorizedResponse(__caller);

and add the import. Internal callers (cron / pg_net / chained Edge Functions) pass because they send the project's
secret key; browsers must send an org-admin session token.

    python tools/add_admin_guard.py            # dry run
    python tools/add_admin_guard.py --apply
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "supabase" / "functions"
APPLY = "--apply" in sys.argv
TARGETS = [
    "ef_alert_digest", "ef_atms_monitor", "ef_calculate_interim_performance_fee", "ef_calculate_management_fees",
    "ef_calculate_performance_fees", "ef_collect_annual_fees", "ef_create_order_intents", "ef_execute_public_backtests",
    "ef_fee_monthly_close", "ef_fetch_onchain_pvr", "ef_fetch_rb_bands", "ef_fetch_usdpc_price", "ef_generate_decisions",
    "ef_market_fallback", "ef_monthly_statement_generator", "ef_poll_orders", "ef_post_ledger_and_balances",
    "ef_renew_rb_token", "ef_revalue_usdpc_nav", "ef_revert_withdrawal_fees", "ef_transfer_accumulated_fees",
    "ef_valr_ws_monitor",
    # second pass (strict audit): cron / admin-only functions that had no recognisable caller check
    "adv-build-transactions", "create-daily-rules", "ef_alert_triage_agent", "ef_convert_zar_to_usdt", "ef_deposit_scan",
    "ef_fetch_ci_bands", "ef_optimize_lth_pvr_strategy", "ef_poll_zar_conversions", "ef_process_withdrawal_queue",
    "ef_reconcile_w09", "ef_rotate_api_key_notifications", "ef_sync_valr_transactions", "ef_tfs_screen", "std-build-transactions",
]
HANDLER = re.compile(r"^(?P<indent>[ \t]*)(?P<pre>(?:Deno\.)?serve\(\s*async\s*\()(?P<param>[^)]*)(?P<post>\)\s*(?::\s*[^=]+?)?\s*=>\s*\{)[ \t]*$", re.M)
IMPORT = 'import { requireOrgAdminAuto, unauthorizedResponse } from "../_shared/adminAuth.ts";'
GUARD = [
    "  // 2026-11-05 hardening: deployed --no-verify-jwt, so authorise every caller here (secret key or org admin).",
    "  const __caller = await requireOrgAdminAuto(req);",
    "  if (!__caller.ok) return unauthorizedResponse(__caller);",
]

done = 0
for name in TARGETS:
    path = ROOT / name / "index.ts"
    text = path.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    if "requireOrgAdminAuto(" in text or "requireOrgAdmin(" in text:
        print(f"{name:42} already guarded, skipped"); continue
    m = HANDLER.search(text)
    if not m:
        print(f"{name:42} !! handler not found"); continue
    param = m.group("param").strip()
    pname = param.split(":")[0].strip() if param else ""
    new_param = param
    if not pname:
        new_param = "req"
    elif pname.startswith("_"):
        new_param = param.replace(pname, pname.lstrip("_"), 1)
    guard_name = new_param.split(":")[0].strip()
    header = f"{m.group('indent')}{m.group('pre')}{new_param}{m.group('post')}"
    body_start = m.end()
    # skip an immediately-following CORS preflight block so OPTIONS keeps returning without auth
    rest = text[body_start:]
    pre = re.match(r"\s*(?://[^\n]*\n\s*)*if\s*\(\s*\w+\.method\s*===?\s*['\"]OPTIONS['\"]\s*\)\s*(\{[\s\S]*?\n[ \t]*\}|return[^\n]*\n)", rest)
    insert_at = body_start + (pre.end() if pre else 0)
    guard = nl.join(GUARD).replace("(req)", f"({guard_name})")
    new = text[: m.start()] + header + text[body_start:insert_at].rstrip(" \t") 
    # ensure we start the guard on its own line
    if not new.endswith("\n"):
        new += nl
    new += guard + nl + text[insert_at:].lstrip("\r\n")
    if "adminAuth.ts" not in new:
        last = None
        for im in re.finditer(r'^import[\s\S]*?from\s+["\'][^"\']+["\'];?[ \t]*$|^import\s+["\'][^"\']+["\'];?[ \t]*$', new, re.M):
            last = im
        new = (new[: last.end()] + nl + IMPORT + new[last.end():]) if last else (IMPORT + nl + new)
    print(f"{name:42} param [{param}] -> [{new_param}]  preflight_skipped={bool(pre)}")
    done += 1
    if APPLY:
        path.write_text(new, encoding="utf-8", newline="")
print(f"\n{'applied' if APPLY else 'dry run'}: {done}/{len(TARGETS)}")
