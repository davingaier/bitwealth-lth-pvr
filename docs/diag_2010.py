import os, urllib.request, urllib.parse, csv, io, json

TOKEN = os.environ.get("RB_API_TOKEN", "")
RB_BASE = "https://api.researchbitcoin.net"

def rb_csv(category, data_field, from_time, to_time):
    params = urllib.parse.urlencode({"resolution": "d1", "from_time": from_time, "to_time": to_time})
    url = f"{RB_BASE}/v2/{category}/{data_field}?{params}"
    req = urllib.request.Request(url, headers={"X-API-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode()
    reader = csv.DictReader(io.StringIO(text))
    result = {}
    for row in reader:
        vals = list(row.values())
        if len(vals) >= 2 and vals[1]:
            try:
                result[vals[0][:10]] = float(vals[1])
            except ValueError:
                pass
    return result

supply = rb_csv("supply_distribution", "supply_lth", "2010-01-01", "2010-12-31")
rp = rb_csv("realizedprice", "realized_price_lth", "2010-01-01", "2010-12-31")
price = rb_csv("price", "price", "2010-01-01", "2010-12-31")

print("RB supply_lth rows in 2010:", len(supply))
print("First dates:", sorted(supply.keys())[:5])
print()

with open("ci_bands_raw_response.json") as f:
    ci_data = json.load(f)["data"]
ci_map = {r["date"]: r for r in ci_data}

print("Comparison for specific dates:")
print(f"{'Date':<12} {'RB supply':>16} {'CI supply':>16} {'RB rp':>12} {'CI rp':>12} {'RB price':>10} {'CI price':>10}")
for d in ["2010-07-17", "2010-07-18", "2011-01-01", "2012-01-01", "2013-01-01", "2021-02-21"]:
    s = supply.get(d, "N/A")
    r2 = rp.get(d, "N/A")
    p = price.get(d, "N/A")
    ci = ci_map.get(d, {})
    cs = ci.get("lth_supply", "N/A")
    cr = ci.get("lth_realized_price", "N/A")
    cp = ci.get("btc_price", "N/A")
    print(f"{d:<12} {str(s):>16} {str(cs):>16} {str(r2):>12} {str(cr):>12} {str(p):>10} {str(cp):>10}")
