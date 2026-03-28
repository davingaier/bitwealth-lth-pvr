import os, urllib.request, urllib.parse, csv, io, json

TOKEN = os.environ.get("RB_API_TOKEN", "")
RB_BASE = "https://api.researchbitcoin.net"

def rb_csv_raw(category, data_field, from_time, to_time):
    params = urllib.parse.urlencode({"resolution": "d1", "from_time": from_time, "to_time": to_time})
    url = f"{RB_BASE}/v2/{category}/{data_field}?{params}"
    req = urllib.request.Request(url, headers={"X-API-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode()
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        vals = list(row.values())
        if len(vals) >= 2:
            try:
                v = float(vals[1]) if vals[1] else 0.0
                rows.append((vals[0][:10], v))
            except ValueError:
                pass
    return rows

# Fetch full history for all three series
print("Fetching full history from 2009 to 2013...")
supply_rows = rb_csv_raw("supply_distribution", "supply_lth", "2009-01-01", "2013-12-31")
rp_rows = rb_csv_raw("realizedprice", "realized_price_lth", "2009-01-01", "2013-12-31")
price_rows = rb_csv_raw("price", "price", "2009-01-01", "2013-12-31")

def first_nonzero(rows):
    for d, v in rows:
        if v and v > 0:
            return d, v
    return None, None

s_start, s_val = first_nonzero(supply_rows)
r_start, r_val = first_nonzero(rp_rows)
p_start, p_val = first_nonzero(price_rows)

print(f"supply_lth first non-zero:        {s_start} = {s_val}")
print(f"realized_price_lth first non-zero: {r_start} = {r_val}")
print(f"price first non-zero:              {p_start} = {p_val}")
print()

# Now compare RB vs CI for a few specific 2013 dates
with open("ci_bands_raw_response.json") as f:
    ci_data = json.load(f)["data"]
ci_map = {r["date"]: r for r in ci_data}

supply_map = {d: v for d, v in supply_rows}
rp_map = {d: v for d, v in rp_rows}
price_map = {d: v for d, v in price_rows}

print("Comparison RB vs CI for early dates:")
header = f"{'Date':<12} {'RB supply':>16} {'CI supply':>16}  {'RB rp':>10} {'CI rp':>10}  {'RB price':>10} {'CI price':>10}"
print(header)
for d in ["2013-01-01", "2013-06-01", "2014-01-01", "2015-01-01", "2017-01-01", "2021-01-01"]:
    ci = ci_map.get(d, {})
    rb_s = supply_map.get(d, "N/A")
    rb_r = rp_map.get(d, "N/A")
    rb_p = price_map.get(d, "N/A")
    ci_s = ci.get("lth_supply", "N/A")
    ci_r = ci.get("lth_realized_price", "N/A")
    ci_p = ci.get("btc_price", "N/A")
    rb_s_str = f"{rb_s:,.0f}" if isinstance(rb_s, float) else rb_s
    ci_s_str = f"{ci_s:,.0f}" if isinstance(ci_s, float) else ci_s
    rb_r_str = f"{rb_r:,.4f}" if isinstance(rb_r, float) else rb_r
    ci_r_str = f"{ci_r:,.4f}" if isinstance(ci_r, float) else ci_r
    rb_p_str = f"{rb_p:,.2f}" if isinstance(rb_p, float) else rb_p
    ci_p_str = f"{ci_p:,.2f}" if isinstance(ci_p, float) else ci_p
    print(f"{d:<12} {rb_s_str:>16} {ci_s_str:>16}  {rb_r_str:>10} {ci_r_str:>10}  {rb_p_str:>10} {ci_p_str:>10}")
