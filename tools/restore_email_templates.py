"""Restore email templates from _email_previews (2026-04-25 DB dump with sample values substituted).

One-off incident tool (2026-11-04). It rebuilds the light/dark logo-pair form; if it is ever re-run, follow it with
`python tools/email_header_navy.py --apply` to convert the headers to the current navy band + single on-dark logo.

For each preview: decode the srcdoc iframe, reverse the sample substitutions (only for keys the template really
uses, per email_logs.template_data), replace the inline base64 logo with the hosted light/dark pair, inject the swap
CSS, then validate the untouched DB head/footer still match before writing back via PostgREST.
"""
import html, json, os, re, sys, urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr")
PREV = ROOT / "_email_previews"
ENV = dict(l.split("=", 1) for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"].strip().strip('"')
URL = "https://wqnmxpooabmedvtackji.supabase.co"
APPLY = "--apply" in sys.argv

LIGHT = f"{URL}/storage/v1/object/public/branding/bitwealth_logo_transparent_cropped.png"
DARK = f"{URL}/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png"
# Round-1 structure (img-level classes, no wrappers): the only form proven to toggle in new Outlook.
LOGO_BLOCK = (
    f'<img class="logo-light" src="{LIGHT}" alt="BitWealth" width="250" style="width: 250px; height: auto; display: block; margin: 0 auto; border: 0;" />'
    f'<img class="logo-dark" src="{DARK}" alt="BitWealth" width="250" style="width: 250px; height: auto; display: none; margin: 0 auto; border: 0; mso-hide: all;" />'
)
CSS = (
    "\n    /* Hosted logo: light by default, dark variant in dark mode. Plain class selectors only — Outlook.com drops element-qualified rules. */"
    "\n    .logo-dark { display: none !important; }"
    "\n    @media (prefers-color-scheme: dark) {"
    "\n      .logo-light { display: none !important; }"
    "\n      .logo-dark { display: block !important; }"
    "\n    }"
    "\n    [data-ogsc] .logo-light { display: none !important; }"
    "\n    [data-ogsc] .logo-dark { display: block !important; }"
    "\n    [data-ogsb] .logo-light { display: none !important; }"
    "\n    [data-ogsb] .logo-dark { display: block !important; }"
    "\n  "
)

# Sample values used by _render_email_templates.py (value -> key). Longer values first.
SAMPLE = {
    "first_name": "Ellie", "last_name": "Landman", "surname": "Landman",
    "email": "elna@analytiqcorpfin.co.za", "customer_id": "52", "country": "South Africa",
    "phone_country_code": "+27", "phone_number": "82 123 4567",
    "upfront_investment_amount_range": "R 100,000 – R 250,000", "monthly_investment_amount_range": "R 10,000 – R 25,000",
    "message": "I would like to learn more about your DCA strategy.", "created_at": "2026-04-25 11:58 UTC",
    "amount": "R 50,000.00", "portal_url": "https://portal.bitwealth.co.za", "kyc_url": "https://portal.bitwealth.co.za/kyc",
    "month_name": "March", "year": "2026", "monthly_invested": "25,000.00", "total_invested": "300,000.00",
    "btc_acquired": "0.01234567", "avg_buy_price": "2,025,000.00", "current_btc_price": "$ 65,432.10", "purchase_count": "8",
    "btc_balance": "0.15678901", "portfolio_value": "$ 10,250.45", "total_return": "12.34", "return_color": "#10b981",
    "performance_fee_rate": "10", "performance_fee_amount": "$ 125.30", "performance_fee_status_text": "Deducted",
    "performance_fee_note": "The performance fee of 10% is calculated on your portfolio gains made for the month (subject to a high-water mark) and has been automatically deducted.",
    "platform_fee_rate": "0.75", "platform_fee_amount": "$ 18.75", "platform_fee_status_text": "Deducted",
    "platform_fee_note": "The platform fee of 0.75% is calculated on your net USDT contributions and has been automatically deducted.",
    "website_url": "https://bitwealth.co.za", "download_url": "https://bitwealth.co.za/statements/sample.pdf",
    "bank_account": "Sample Bank •••• 7890", "destination_address": "bc1qsampledestinationaddress0123456789xyz",
    "ticket_id": "TICKET-001", "subject_line": "Sample subject", "ticket_subject": "Help with deposit",
    "reply_message": "Thanks for reaching out, we're on it.", "withdrawal_amount": "R 10,000.00", "wallet_address": "bc1qsample...",
    "transaction_id": "tx_abc123", "reference": "BW-REF-001", "deposit_reference": "DEP-001", "bank_name": "Sample Bank",
    "account_number": "1234567890", "branch_code": "123456", "swift_code": "SAMPZAJJ",
}
# Keys whose sample value is too generic to reverse blindly; handled contextually below.
RISKY = {"year", "purchase_count", "performance_fee_rate", "platform_fee_rate", "return_color", "total_return",
         "performance_fee_status_text", "platform_fee_status_text", "customer_id", "branch_code", "month_name"}


def rest(path, method="GET", body=None):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null") if method == "GET" else r.status


db = {r["template_key"]: r["body_html"] for r in rest("email_templates?select=template_key,body_html")}
logs = {r["template_key"]: set(r["keys"].split(",")) for r in rest(
    "rpc/exec_sql_ro", "POST", {"q": ""}) } if False else {}
# key sets from email_logs (fetched via SQL earlier) — hard-coded to avoid needing an RPC
LOG_KEYS = {
    "deposit_instructions": "btc_wallet_address,deposit_ref,deposit_reference,first_name,usdt_wallet_address,website_url",
    "funds_deposited_admin_notification": "balances,customer_id,email,first_name,last_name,to_email",
    "kyc_documents_uploaded_notification": "admin_portal_url,customer_id,email,first_name,kyc_bank_confirmation_file_path,kyc_id_file_path,kyc_proof_address_file_path,kyc_source_of_income,kyc_source_of_income_file_path,last_name,upload_date",
    "kyc_portal_registration": "first_name,registration_url,strategy_name,website_url",
    "monthly_statement": "avg_buy_price,btc_acquired,btc_balance,current_btc_price,download_url,fee_plan,first_name,management_fee_amount,management_fee_rate,management_fee_status_text,month_name,monthly_invested,performance_fee_amount,performance_fee_note,performance_fee_rate,performance_fee_status_text,platform_fee_amount,platform_fee_note,platform_fee_rate,platform_fee_status_text,portal_url,portfolio_value,purchase_count,return_color,total_invested,total_return,website_url,year",
    "prospect_confirmation": "first_name,website_url",
    "prospect_notification": "admin_portal_url,country,created_at,email,first_name,message,monthly_investment_amount_range,phone_country_code,phone_number,surname,upfront_investment_amount_range",
    "registration_complete_welcome": "amount,asset,deposit_date,first_name,portal_url,website_url",
    "subsequent_deposit_notification": "amount,asset,deposit_date,first_name,portal_url,to_email,website_url",
    "kyc_verified_notification": "first_name,registration_url,website_url",
}
norm = lambda s: re.sub(r"\s+", "", s)


def decode(key):
    raw = (PREV / f"{key}.html").read_text(encoding="utf-8")
    m = re.search(r'srcdoc="(.*?)"></iframe>', raw, re.S)
    return html.unescape(m.group(1))


def reverse(key, p):
    used = set(LOG_KEYS.get(key, "").split(",")) if key in LOG_KEYS else None
    items = sorted(SAMPLE.items(), key=lambda kv: -len(kv[1]))
    for k, v in items:
        if k in RISKY:
            continue
        if used is not None and k not in used:
            continue
        if k == "website_url":
            p = re.sub(re.escape(v) + r"(?![/\w])", "{{website_url}}", p)
        else:
            p = p.replace(v, "{{%s}}" % k)
    if key == "monthly_statement":
        p = p.replace("March 2026", "{{month_name}} {{year}}")
        p = p.replace("(10%)", "({{performance_fee_rate}}%)").replace("(0.75%)", "({{platform_fee_rate}}%)")
        p = p.replace("Deducted", "{{performance_fee_status_text}}", 1).replace("Deducted", "{{platform_fee_status_text}}", 1)
        p = re.sub(r"(Purchases This Month:\s*(?:</[^>]+>\s*<[^>]+>\s*)*)8(?=\s*<)", r"\g<1>{{purchase_count}}", p)
        p = re.sub(r"12\.34(?=%)", "{{total_return}}", p)
        p = p.replace("#10b981", "{{return_color}}")
    if key in ("funds_deposited_admin_notification", "kyc_documents_uploaded_notification"):
        p = re.sub(r"(?<![\w#.\-])52(?![\w.\-%])", "{{customer_id}}", p)
    return p


def hosted(p):
    p = re.sub(r'<img[^>]*src="data:image[^"]*"[^>]*>', LOGO_BLOCK, p)
    if "</style>" in p:
        p = p.replace("</style>", CSS + "</style>", 1)
    elif "<head>" in p:
        p = p.replace("<head>", "<head><style>" + CSS + "</style>", 1)
    return p


def db_parts(cur):
    pre = cur.split('<div class="logo-light"')[0]
    i = cur.find('<div class="logo-dark"'); j = cur.find("</div>", cur.find("<img", i)) + 6
    return pre, cur[j:]


results = {}
report = []
for f in sorted(PREV.glob("*.html")):
    key = f.stem
    if key == "index" or key not in db:
        continue
    cur = db[key]
    cur_pre, cur_tail = db_parts(cur)
    p = reverse(key, decode(key))
    m = re.search(r'<img[^>]*src="data:image[^"]*"[^>]*>', p)
    post = p[m.end():]
    strategy = "full"
    if key == "kyc_portal_registration":
        # Post-April the CTA became a bulletproof table button (survives in the DB tail); splice the preview middle in front of it.
        k = re.search(r'<table width="100%" cellpadding="0" cellspacing="0" border="0">\s*<tr>\s*<td align="center" style="padding: 20px 0;">', post)
        new = cur_pre.replace('<div class="logo-light"', "") + LOGO_BLOCK + post[:k.start()] + cur_tail
        strategy = "splice-before-cta"
    elif key == "prospect_confirmation":
        # Only the header wrapper's closing </div> was lost; the whole body survives in the DB tail.
        new = cur_pre + LOGO_BLOCK + "</div>" + cur_tail
        strategy = "close-header-div"
    elif key in ("kyc_documents_uploaded_notification", "prospect_notification"):
        # Post-April the <div class="container"> became table wrappers (DB prefix/tail); the inner divs are unchanged.
        new = cur_pre + LOGO_BLOCK + post[: post.rfind("</div>")] + cur_tail
        strategy = "splice-into-tables"
    else:
        new = hosted(p)
    if strategy != "full":
        # cur_pre already carries the swap CSS from the earlier (broken) migration run
        pass
    # validation
    new_pre = new.split('<img class="logo-light"')[0]
    cur_pre_nocss = re.sub(r"\n    /\* Hosted logo:.*?\n  </style>", "\n  </style>", cur_pre, flags=re.S)
    new_pre_nocss = re.sub(r"\n    /\* Hosted logo:.*?\n  </style>", "\n  </style>", new_pre, flags=re.S)
    head_ok = norm(cur_pre_nocss) == norm(new_pre_nocss)
    tail_ok = norm(cur_tail) in norm(new)
    css_ok = new.count("/* Hosted logo:") == 1
    no_inline = "data:image" not in new
    placeholders = sorted(set(re.findall(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", new)))
    unknown = [x for x in placeholders if key in LOG_KEYS and x not in LOG_KEYS[key].split(",")]
    leftovers = [v for k2, v in SAMPLE.items() if k2 not in RISKY and k2 != "website_url" and v in new and (key not in LOG_KEYS or k2 in LOG_KEYS[key].split(","))]
    if not tail_ok:
        tn, nn = norm(cur_tail), norm(new); L = 0
        while L < len(tn) and nn.find(tn[:L+20]) >= 0: L += 20
        print(f"   [{key}] tail diverges at {L}: DB={tn[max(0,L-30):L+90]}")
    ok = head_ok and tail_ok and css_ok and no_inline and not unknown and not leftovers
    results[key] = (new, ok)
    print(f"{key:40s} {strategy:20s} ok={ok} head={head_ok} tail={tail_ok} css={css_ok} inline={not no_inline} unknown={unknown} leftovers={leftovers} len={len(new)}")

if APPLY:
    for key, (p, ok) in results.items():
        if not ok:
            print("SKIP (not validated)", key); continue
        st = rest(f"email_templates?template_key=eq.{key}", "PATCH", {"body_html": p})
        print("PATCH", key, st)