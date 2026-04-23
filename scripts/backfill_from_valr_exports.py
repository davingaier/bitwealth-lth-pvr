"""
One-shot importer: rebuild lth_pvr.exchange_funding_events + ledger_lines for
the three active customers (31, 48, 999) from VALR transaction-history CSV
exports placed under ./data/valr_exports/.

CSV columns (VALR portal export):
  date, transaction type, debit currency, debit value, credit currency,
  credit value, fee currency, fee value, trade currency pair,
  trade price currency, trade price, order id, address, transactionHash

Mapping rules (per row):
  Transfer (credit only)            -> deposit/zar_deposit (subaccount IN)
  Transfer (debit  only)            -> withdrawal/zar_withdrawal (subaccount OUT)
  Deposit (credit ZAR only)         -> zar_deposit
  Withdraw (debit ZAR only)         -> zar_withdrawal (amount = -(debit + fee))
  Send (debit crypto only)          -> withdrawal (amount = -(debit + fee))
  Receive (credit crypto only)      -> deposit
  Off-chain blockchain deposit      -> deposit (treated like Receive)
  Simple/Limit/Market Buy on ZAR pair  -> TWO events: ZAR debit out + crypto credit in
  Simple/Limit/Market Sell on ZAR pair -> TWO events: crypto debit out + ZAR credit in
  Trades on BTCUSDT                 -> SKIPPED (not present for active customers)

Usage:
  python scripts/backfill_from_valr_exports.py > scripts/backfill_from_valr_exports.sql
"""
from __future__ import annotations
import csv
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ORG_ID = "b0a77009-03b9-44a1-ae1d-34f157d44a8b"

# customer_id -> (csv_path, exchange_account_id)
CUSTOMERS = {
    31:  ("data/valr_exports/customer_31_20260423.csv",  "734cd9c0-4e6f-4510-aaa1-a088779c16bc"),
    48:  ("data/valr_exports/customer_48_20260423.csv",  "2e78019d-0101-4584-9e14-95bbf72de8c9"),
    999: ("data/valr_exports/customer_999_20260423.csv", "1da38bcb-8c24-464d-81a0-7b388f84c8b3"),
}

ROOT = Path(__file__).resolve().parent.parent

def parse_dt(s: str) -> datetime:
    # "2026-04-22 18:23:07 Z"
    s = s.strip().rstrip("Z").rstrip()
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

def num(s: str) -> float:
    s = (s or "").strip()
    return float(s) if s else 0.0


@dataclass
class Event:
    customer_id: int
    occurred_at: datetime
    kind: str            # deposit|withdrawal|zar_deposit|zar_withdrawal
    asset: str           # BTC|USDT|ZAR
    amount: float        # signed (positive=in, negative=out)
    ext_ref: str
    idempotency_key: str
    metadata: dict


def emit_events(customer_id: int, csv_path: Path) -> list[Event]:
    events: list[Event] = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=1):
            ts        = parse_dt(row["date"])
            ttype     = (row["transaction type"] or "").strip()
            debit_cur = (row["debit currency"] or "").strip()
            debit_val = num(row["debit value"])
            cred_cur  = (row["credit currency"] or "").strip()
            cred_val  = num(row["credit value"])
            fee_cur   = (row["fee currency"] or "").strip()
            fee_val   = num(row["fee value"])
            pair      = (row["trade currency pair"] or "").strip()
            order_id  = (row["order id"] or "").strip()

            # Build a deterministic, unique synthetic ext_ref for rows without one
            # (Deposit/Withdraw/Transfer don't carry an order_id in the export).
            base_ref = order_id or f"VALR_C{customer_id}_{ts.strftime('%Y%m%d%H%M%S')}_{i:03d}"

            ttype_l = ttype.lower()

            if ttype_l in ("deposit",):
                # Always credit ZAR
                events.append(Event(customer_id, ts, "zar_deposit", "ZAR", cred_val,
                                    base_ref, f"VALR_BF_{base_ref}",
                                    {"source": "csv_backfill", "tx_type": ttype}))
                continue

            if ttype_l in ("withdraw", "withdrawal"):
                # Always debit ZAR; fee is in addition to debit_val
                total = debit_val + fee_val
                events.append(Event(customer_id, ts, "zar_withdrawal", "ZAR", -total,
                                    base_ref, f"VALR_BF_{base_ref}",
                                    {"source": "csv_backfill", "tx_type": ttype,
                                     "fee_amount": fee_val, "fee_asset": fee_cur}))
                continue

            if ttype_l in ("transfer",):
                # Internal transfer subaccount <-> main
                if cred_val > 0 and cred_cur:
                    kind = "zar_deposit" if cred_cur == "ZAR" else "deposit"
                    events.append(Event(customer_id, ts, kind, cred_cur, cred_val,
                                        base_ref, f"VALR_BF_{base_ref}",
                                        {"source": "csv_backfill", "tx_type": "Transfer (in)"}))
                elif debit_val > 0 and debit_cur:
                    kind = "zar_withdrawal" if debit_cur == "ZAR" else "withdrawal"
                    events.append(Event(customer_id, ts, kind, debit_cur, -debit_val,
                                        base_ref, f"VALR_BF_{base_ref}",
                                        {"source": "csv_backfill", "tx_type": "Transfer (out)"}))
                else:
                    print(f"-- WARN: skipped malformed Transfer row {i}: {row}", file=sys.stderr)
                continue

            if ttype_l in ("send",):
                # External crypto withdrawal; fee in addition to debit
                total = debit_val + fee_val
                events.append(Event(customer_id, ts, "withdrawal", debit_cur, -total,
                                    base_ref, f"VALR_BF_{base_ref}",
                                    {"source": "csv_backfill", "tx_type": "Send",
                                     "fee_amount": fee_val, "fee_asset": fee_cur}))
                continue

            if ttype_l in ("receive", "off-chain blockchain deposit"):
                kind = "zar_deposit" if cred_cur == "ZAR" else "deposit"
                events.append(Event(customer_id, ts, kind, cred_cur, cred_val,
                                    base_ref, f"VALR_BF_{base_ref}",
                                    {"source": "csv_backfill", "tx_type": ttype}))
                continue

            if ttype_l in ("simple buy", "limit buy", "market buy",
                           "simple sell", "limit sell", "market sell"):
                # Pair trade
                if "ZAR" in pair:
                    # Conversion: emit BOTH legs
                    # Debit side: out of subaccount
                    if debit_cur and debit_val:
                        kind_d = "zar_withdrawal" if debit_cur == "ZAR" else "withdrawal"
                        meta_d = {"source": "csv_backfill", "tx_type": ttype,
                                  "pair": pair, "leg": "debit",
                                  "conversion_to": cred_cur,
                                  "conversion_to_amount": cred_val,
                                  "fee_amount": fee_val, "fee_asset": fee_cur}
                        events.append(Event(customer_id, ts, kind_d, debit_cur, -debit_val,
                                            base_ref, f"VALR_BF_{base_ref}_DEBIT_{i:03d}",
                                            meta_d))
                    # Credit side: into subaccount (already net of fee in CSV when fee_cur == cred_cur)
                    if cred_cur and cred_val:
                        kind_c = "zar_deposit" if cred_cur == "ZAR" else "deposit"
                        meta_c = {"source": "csv_backfill", "tx_type": ttype,
                                  "pair": pair, "leg": "credit",
                                  "conversion_from": debit_cur,
                                  "conversion_from_amount": debit_val,
                                  "fee_amount": fee_val, "fee_asset": fee_cur}
                        events.append(Event(customer_id, ts, kind_c, cred_cur, cred_val,
                                            base_ref, f"VALR_BF_{base_ref}_CREDIT_{i:03d}",
                                            meta_c))
                elif pair == "BTCUSDT":
                    # Strategy fill — out of scope for the funding-only backfill
                    print(f"-- WARN: BTCUSDT trade not booked into funding (handled by order_fills): row {i} cust {customer_id}", file=sys.stderr)
                else:
                    print(f"-- WARN: unknown pair {pair} on row {i} cust {customer_id}", file=sys.stderr)
                continue

            print(f"-- WARN: unhandled transaction type '{ttype}' on row {i} cust {customer_id}: {row}", file=sys.stderr)

    return events


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def emit_sql(all_events: list[Event]) -> None:
    cust_ids = sorted({e.customer_id for e in all_events})
    ids_csv = ",".join(str(c) for c in cust_ids)

    print("-- ===========================================================")
    print("-- One-shot backfill: rebuild funding events + ledger lines for")
    print(f"-- customers {ids_csv} from VALR CSV exports.")
    print(f"-- Generated by scripts/backfill_from_valr_exports.py")
    print(f"-- Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("-- ===========================================================")
    print()
    print("BEGIN;")
    print()
    print(f"-- 1) Wipe existing funding/ledger/balance rows for in-scope customers")
    print(f"DELETE FROM lth_pvr.balances_daily       WHERE customer_id IN ({ids_csv});")
    print(f"DELETE FROM lth_pvr.hodl_balances_daily  WHERE customer_id IN ({ids_csv});")
    print(f"DELETE FROM lth_pvr.std_dca_balances_daily WHERE customer_id IN ({ids_csv});")
    print(f"DELETE FROM lth_pvr.ledger_lines         WHERE customer_id IN ({ids_csv}) AND kind IN ('topup','withdrawal','deposit','transfer');")
    print(f"DELETE FROM lth_pvr.exchange_funding_events WHERE customer_id IN ({ids_csv});")
    print()

    print("-- 2) Insert reconstructed funding events AND matching ledger lines.")
    print("--    The ledger lines are inserted directly (kind=topup/withdrawal)")
    print("--    rather than letting ef_post_ledger_and_balances derive them, to avoid")
    print("--    re-charging the 0.75% platform fee on historical deposits.")
    print("--    Once the matching note='funding:<uuid>' exists, the edge function will")
    print("--    skip these funding events on its next run.")
    print()
    for e in sorted(all_events, key=lambda x: (x.customer_id, x.occurred_at, x.idempotency_key)):
        exch = CUSTOMERS[e.customer_id][1]
        meta_json = "jsonb_build_object(" + ", ".join(
            f"{sql_str(k)}, {sql_str(str(v)) if not isinstance(v, (int, float)) else repr(v)}"
            for k, v in e.metadata.items()
        ) + ")" if e.metadata else "'{}'::jsonb"
        # Determine ledger kind + signed amounts per asset
        ledger_kind = "topup" if e.amount >= 0 else "withdrawal"
        amt_btc  = e.amount if e.asset == "BTC"  else 0
        amt_usdt = e.amount if e.asset == "USDT" else 0
        amt_zar  = e.amount if e.asset == "ZAR"  else 0
        trade_date = e.occurred_at.date().isoformat()
        print("WITH ins AS (")
        print("  INSERT INTO lth_pvr.exchange_funding_events")
        print("    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)")
        print(f"  VALUES (gen_random_uuid(), '{ORG_ID}', {e.customer_id}, '{exch}',")
        print(f"          {sql_str(e.kind)}, {sql_str(e.asset)}, {e.amount!r}, {sql_str(e.ext_ref)},")
        print(f"          {sql_str(e.occurred_at.isoformat())}, {sql_str(e.idempotency_key)}, {meta_json})")
        print("  RETURNING funding_id")
        print(")")
        print("INSERT INTO lth_pvr.ledger_lines")
        print("    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)")
        print(f"SELECT '{ORG_ID}', {e.customer_id}, DATE {sql_str(trade_date)}, {sql_str(ledger_kind)},")
        print(f"       {amt_btc!r}, {amt_usdt!r}, {amt_zar!r}, 0, 0, 0, 0,")
        print("       'funding:' || ins.funding_id::text")
        print("FROM ins;")
    print()
    print("COMMIT;")


def emit_sql_to(out, all_events: list[Event], include_wipe: bool, include_tx: bool) -> None:
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        # Reuse emit_sql's body but skip wipe/tx as requested
        cust_ids = sorted({e.customer_id for e in all_events})
        ids_csv = ",".join(str(c) for c in cust_ids)
        if include_tx:
            print("BEGIN;")
            print()
        if include_wipe:
            print(f"DELETE FROM lth_pvr.balances_daily       WHERE customer_id IN ({ids_csv});")
            print(f"DELETE FROM lth_pvr.hodl_balances_daily  WHERE customer_id IN ({ids_csv});")
            print(f"DELETE FROM lth_pvr.std_dca_balances_daily WHERE customer_id IN ({ids_csv});")
            print(f"DELETE FROM lth_pvr.ledger_lines         WHERE customer_id IN ({ids_csv}) AND kind IN ('topup','withdrawal','deposit','transfer');")
            print(f"DELETE FROM lth_pvr.exchange_funding_events WHERE customer_id IN ({ids_csv});")
            print()
        for e in sorted(all_events, key=lambda x: (x.customer_id, x.occurred_at, x.idempotency_key)):
            exch = CUSTOMERS[e.customer_id][1]
            meta_json = "jsonb_build_object(" + ", ".join(
                f"{sql_str(k)}, {sql_str(str(v)) if not isinstance(v, (int, float)) else repr(v)}"
                for k, v in e.metadata.items()
            ) + ")" if e.metadata else "'{}'::jsonb"
            ledger_kind = "topup" if e.amount >= 0 else "withdrawal"
            amt_btc  = e.amount if e.asset == "BTC"  else 0
            amt_usdt = e.amount if e.asset == "USDT" else 0
            amt_zar  = e.amount if e.asset == "ZAR"  else 0
            trade_date = e.occurred_at.date().isoformat()
            print("WITH ins AS (")
            print("  INSERT INTO lth_pvr.exchange_funding_events")
            print("    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)")
            print(f"  VALUES (gen_random_uuid(), '{ORG_ID}', {e.customer_id}, '{exch}',")
            print(f"          {sql_str(e.kind)}, {sql_str(e.asset)}, {e.amount!r}, {sql_str(e.ext_ref)},")
            print(f"          {sql_str(e.occurred_at.isoformat())}, {sql_str(e.idempotency_key)}, {meta_json})")
            print("  RETURNING funding_id")
            print(")")
            print("INSERT INTO lth_pvr.ledger_lines")
            print("    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)")
            print(f"SELECT '{ORG_ID}', {e.customer_id}, DATE {sql_str(trade_date)}, {sql_str(ledger_kind)},")
            print(f"       {amt_btc!r}, {amt_usdt!r}, {amt_zar!r}, 0, 0, 0, 0,")
            print("       'funding:' || ins.funding_id::text")
            print("FROM ins;")
        if include_tx:
            print()
            print("COMMIT;")
    out.write(buf.getvalue())


def main() -> None:
    all_events: list[Event] = []
    for cust_id, (csv_rel, _exch) in CUSTOMERS.items():
        path = ROOT / csv_rel
        if not path.exists():
            print(f"-- ERROR: missing {path}", file=sys.stderr)
            sys.exit(1)
        ev = emit_events(cust_id, path)
        print(f"-- customer {cust_id}: {len(ev)} events from {csv_rel}", file=sys.stderr)
        all_events.extend(ev)

    # Always emit the combined transactional file (handy for psql / manual use)
    emit_sql(all_events)

    # Also emit one per-customer fragment (no BEGIN/COMMIT, no wipe) for chunked apply
    out_dir = ROOT / "scripts" / "_backfill_chunks"
    out_dir.mkdir(parents=True, exist_ok=True)
    # Wipe chunk first
    with open(out_dir / "00_wipe.sql", "w", encoding="utf-8") as f:
        emit_sql_to(f, all_events, include_wipe=True, include_tx=False)
        # Truncate the inserted events part by re-running with empty list:
    # Better: write per customer
    for cust_id in sorted({e.customer_id for e in all_events}):
        cust_events = [e for e in all_events if e.customer_id == cust_id]
        with open(out_dir / f"01_customer_{cust_id}.sql", "w", encoding="utf-8") as f:
            emit_sql_to(f, cust_events, include_wipe=False, include_tx=False)
    # Re-write 00_wipe.sql with only the wipe statements
    with open(out_dir / "00_wipe.sql", "w", encoding="utf-8") as f:
        cust_ids = sorted({e.customer_id for e in all_events})
        ids_csv = ",".join(str(c) for c in cust_ids)
        f.write(f"DELETE FROM lth_pvr.balances_daily       WHERE customer_id IN ({ids_csv});\n")
        f.write(f"DELETE FROM lth_pvr.hodl_balances_daily  WHERE customer_id IN ({ids_csv});\n")
        f.write(f"DELETE FROM lth_pvr.std_dca_balances_daily WHERE customer_id IN ({ids_csv});\n")
        f.write(f"DELETE FROM lth_pvr.ledger_lines         WHERE customer_id IN ({ids_csv}) AND kind IN ('topup','withdrawal','deposit','transfer');\n")
        f.write(f"DELETE FROM lth_pvr.exchange_funding_events WHERE customer_id IN ({ids_csv});\n")


if __name__ == "__main__":
    main()
