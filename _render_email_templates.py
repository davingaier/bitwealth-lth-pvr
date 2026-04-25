"""Render all active email templates to local HTML files for visual review."""
import json, os, re, html, webbrowser
from pathlib import Path

SRC = r"c:\Users\davin\AppData\Roaming\Code\User\workspaceStorage\623d70f03ab620e87c883410a49bb7e9\GitHub.copilot-chat\chat-session-resources\564bd449-5057-443e-800b-783fcb3e6354\toolu_vrtx_01NAtwK7eXwtpc4NayPZZGQo__vscode-1777009852086\content.json"
OUT = Path(r"c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr\_email_previews")
OUT.mkdir(exist_ok=True)

with open(SRC, "r", encoding="utf-8") as f:
    payload = json.load(f)

# Payload is {"result": "<text with embedded JSON inside <untrusted-data-...> boundaries>"}
text = payload["result"] if isinstance(payload, dict) and "result" in payload else payload
m = re.search(r"<untrusted-data-[^>]+>\s*(\[.*?\])\s*</untrusted-data-[^>]+>", text, re.DOTALL)
if not m:
    raise SystemExit("Could not locate inner JSON array")
rows = json.loads(m.group(1))

print(f"Loaded {len(rows)} templates")

# Sample placeholder substitutions so previews look realistic
SAMPLE = {
    "first_name": "Ellie", "first_names": "Ellie", "surname": "Landman", "last_name": "Landman",
    "full_name": "Ellie Landman", "name": "Ellie Landman",
    "email": "elna@analytiqcorpfin.co.za", "email_address": "elna@analytiqcorpfin.co.za",
    "customer_id": "52", "phone_country_code": "+27", "phone_number": "82 123 4567",
    "cell_number": "+27 82 123 4567", "country": "South Africa",
    "upfront_investment_amount_range": "R 100,000 – R 250,000",
    "monthly_investment_amount_range": "R 10,000 – R 25,000",
    "message": "I would like to learn more about your DCA strategy.",
    "created_at": "2026-04-25 11:58 UTC", "submission_date": "2026-04-25 11:58 UTC",
    "amount": "R 50,000.00", "currency": "ZAR", "btc_amount": "0.00123456",
    "transaction_id": "tx_abc123", "reference": "BW-REF-001",
    "ticket_id": "TICKET-001", "subject_line": "Sample subject",
    "portfolio_name": "LTH PVR BTC DCA", "portal_url": "https://portal.bitwealth.co.za",
    "kyc_url": "https://portal.bitwealth.co.za/kyc",
    "withdrawal_amount": "R 10,000.00", "wallet_address": "bc1qsample...",
    "month": "April 2026", "nav": "R 1,234,567.89", "performance": "+12.34%",
    "deposit_reference": "DEP-001", "bank_name": "Sample Bank", "account_number": "1234567890",
    "branch_code": "123456", "swift_code": "SAMPZAJJ",
    "api_key_name": "primary", "rotation_date": "2026-05-01",
    "ticket_subject": "Help with deposit", "ticket_status": "open",
    "reply_message": "Thanks for reaching out, we're on it.",
    "support_agent": "Davin",
    # monthly_statement (v0.6.91 redesign)
    "month_name": "March", "year": "2026",
    "monthly_invested": "25,000.00", "total_invested": "300,000.00",
    "btc_acquired": "0.01234567", "avg_buy_price": "2,025,000.00",
    "current_btc_price": "$ 65,432.10", "purchase_count": "8",
    "btc_balance": "0.15678901", "portfolio_value": "$ 10,250.45",
    "total_return": "12.34", "return_color": "#10b981",
    "performance_fee_rate": "10", "performance_fee_amount": "$ 125.30",
    "performance_fee_status_text": "Deducted",
    "performance_fee_note": "The performance fee of 10% is calculated on your portfolio gains made for the month (subject to a high-water mark) and has been automatically deducted.",
    "platform_fee_rate": "0.75", "platform_fee_amount": "$ 18.75",
    "platform_fee_status_text": "Deducted",
    "platform_fee_note": "The platform fee of 0.75% is calculated on your net USDT contributions and has been automatically deducted.",
    "website_url": "https://bitwealth.co.za",
    "download_url": "https://bitwealth.co.za/statements/sample.pdf",
    # withdrawal_approved_zar / _crypto (v0.6.91)
    "bank_account": "Sample Bank •••• 7890",
    "destination_address": "bc1qsampledestinationaddress0123456789xyz",
}

placeholder_re = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

def substitute(html_str: str) -> str:
    def repl(m):
        k = m.group(1)
        return SAMPLE.get(k, m.group(0))
    return placeholder_re.sub(repl, html_str)

index_items = []
for r in rows:
    key = r.get("template_key") or "unknown"
    subj = r.get("subject") or ""
    body = r.get("body_html") or ""
    rendered = substitute(body)
    fp = OUT / f"{key}.html"
    # Wrap so we can show subject above the email body
    wrapper = f"""<!doctype html>
<html><head><meta charset=\"utf-8\"><title>{html.escape(key)}</title>
<style>
  body {{ margin:0; font-family: 'Segoe UI', Arial, sans-serif; background:#e5e7eb; }}
  .toolbar {{ position:sticky; top:0; background:#032C48; color:#fff; padding:12px 20px; display:flex; gap:16px; align-items:center; z-index:10; }}
  .toolbar a {{ color:#7dd3fc; text-decoration:none; }}
  .toolbar .key {{ font-weight:bold; font-size:16px; }}
  .toolbar .subj {{ opacity:0.85; font-size:13px; }}
  .frame-wrap {{ padding:24px; }}
  iframe {{ width:100%; height:calc(100vh - 110px); border:1px solid #cbd5e1; background:#fff; }}
</style></head>
<body>
  <div class=\"toolbar\">
    <a href=\"index.html\">← All templates</a>
    <span class=\"key\">{html.escape(key)}</span>
    <span class=\"subj\">Subject: {html.escape(substitute(subj))}</span>
  </div>
  <div class=\"frame-wrap\"><iframe srcdoc=\"{html.escape(rendered, quote=True)}\"></iframe></div>
</body></html>"""
    fp.write_text(wrapper, encoding="utf-8")
    index_items.append((key, subj))

# Build index page
idx_rows = "\n".join(
    f'<li><a href="{html.escape(k)}.html" target="_blank">{html.escape(k)}</a> '
    f'<span class="s">— {html.escape(s)}</span></li>'
    for k, s in sorted(index_items)
)
(OUT / "index.html").write_text(f"""<!doctype html>
<html><head><meta charset=\"utf-8\"><title>BitWealth Email Templates</title>
<style>
 body {{ font-family:'Segoe UI',Arial,sans-serif; max-width:900px; margin:30px auto; padding:0 20px; color:#0f172a; }}
 h1 {{ color:#032C48; }}
 ul {{ line-height:1.9; padding-left:18px; }}
 a {{ color:#0369a1; text-decoration:none; font-weight:600; }}
 a:hover {{ text-decoration:underline; }}
 .s {{ color:#64748b; font-weight:400; font-size:13px; }}
 .meta {{ background:#f1f5f9; padding:10px 14px; border-left:3px solid #032C48; margin:14px 0 24px; font-size:13px; }}
</style></head>
<body>
 <h1>BitWealth Email Templates ({len(index_items)} active)</h1>
 <div class=\"meta\">Click any link to preview. Each preview is the raw template body_html with sample placeholder values substituted (Ellie Landman / R 50,000 etc.). Toggle your OS dark mode and refresh to see the dark-mode header.</div>
 <ul>{idx_rows}</ul>
</body></html>""", encoding="utf-8")

print(f"Wrote {len(index_items)} templates + index.html to {OUT}")
print(f"Open: {OUT / 'index.html'}")
