import json
with open("ci_bands_raw_response.json") as f:
    rows = json.load(f)["data"]

print("cumulative_std_dev for first 5 and last 5 rows:")
for r in rows[:5] + rows[-5:]:
    d = r["date"]
    cs = r["cumulative_std_dev"]
    pvr = r["lth_pvr"]
    un = r["lth_market_cap"] - r["lth_realized_cap"]
    pvr_check = un / cs if cs > 0 else 0
    print(f"  {d}  cum_std={cs:>22,.2f}  lth_pvr={pvr:.6f}  check={pvr_check:.6f}")

print()
stds = set(r["cumulative_std_dev"] for r in rows)
print("Unique cumulative_std_dev values:", len(stds))
print("Min:", min(stds))
print("Max:", max(stds))
