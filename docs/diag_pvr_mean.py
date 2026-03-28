"""
Diagnostic: compute pvr_mean directly from CI's own data to verify,
then check what pvr_mean RB would give if we started later,
and also try recomputing with RB data using CI's cumulative approach exactly.
"""
import json, numpy as np

with open("ci_bands_raw_response.json") as f:
    rows = json.load(f)["data"]

pvr_vals = [r["lth_pvr"] for r in rows]
print(f"CI data rows: {len(rows)}")
print(f"CI pvr range: {min(pvr_vals):.4f} to {max(pvr_vals):.4f}")
print(f"CI pvr mean:  {np.mean(pvr_vals):.6f}   (matches pvr_mean field: {rows[-1]['pvr_mean']:.6f})")
print(f"CI pvr std:   {np.std(pvr_vals, ddof=1):.6f}")
print()

# How many rows have pvr < 0.1? (small early values)
small = [r for r in rows if abs(r["lth_pvr"]) < 0.1]
large = [r for r in rows if r["lth_pvr"] > 2.0]
print(f"Rows with |pvr| < 0.1 (small early): {len(small)} ({len(small)/len(rows)*100:.1f}%)")
print(f"Rows with pvr > 2.0 (large):          {len(large)} ({len(large)/len(rows)*100:.1f}%)")
print()

# Let's see what happens if we compute pvr_mean using only 2013-onwards (our RB range)
rows_2013 = [r for r in rows if r["date"] >= "2013-01-01"]
pvr_2013 = [r["lth_pvr"] for r in rows_2013]
print(f"CI rows from 2013 onwards: {len(rows_2013)}")
print(f"CI pvr_mean (2013 onward): {np.mean(pvr_2013):.6f}")
print(f"CI pvr_std  (2013 onward): {np.std(pvr_2013, ddof=1):.6f}")
print()

# Compute cum_std at 2013-01-01 in CI's dataset
ci_2013 = next((r for r in rows if r["date"] == "2013-01-01"), None)
if ci_2013:
    print(f"CI cumulative_std_dev at 2013-01-01: ${ci_2013['cumulative_std_dev']:,.0f}")
    print(f"CI lth_pvr at 2013-01-01:            {ci_2013['lth_pvr']:.6f}")

# Compute what global_std would be if we use ONLY 2013-onwards LTH_MC from CI data
lth_mc_2013 = [r["lth_market_cap"] for r in rows_2013]
global_std_2013 = np.std(lth_mc_2013, ddof=1)
print()
print(f"Global std(LTH_MC) from 2013 onwards (CI data): ${global_std_2013:,.0f}")
print(f"Compare: our RB global std from 2013:            $473,512,082,624")
print(f"Compare: CI full-history static std:             $453,733,434,968")
print()

# If we use static denominator with 2013-onwards and CI's data, what pvr_mean do we get?
unrealized_2013 = [r["lth_market_cap"] - r["lth_realized_cap"] for r in rows_2013]
pvr_static_ci_2013 = [u / global_std_2013 for u in unrealized_2013]
print(f"pvr_mean (static denom, CI 2013-2026 data): {np.mean(pvr_static_ci_2013):.6f}")
