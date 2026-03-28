"""Compute Welford seed values from CI raw response for the rb_bands_state migration."""
import json, math, statistics

with open("ci_bands_raw_response.json") as f:
    rows = json.load(f)["data"]

lth_mcs = [r["lth_market_cap"] for r in rows if r.get("lth_market_cap", 0) > 0]
n = len(lth_mcs)
mean = sum(lth_mcs) / n
var = statistics.variance(lth_mcs)   # ddof=1 sample variance
std = math.sqrt(var)
m2 = var * (n - 1)

# CI's stored constants from the most recent row
ci_last = rows[-1]
pvr_mean = ci_last["pvr_mean"]
pvr_std_from_ci = ci_last["pvr_plus_1sigma"] - pvr_mean  # = 1sigma

print("=== Seed values for rb_bands_state migration ===")
print()
print(f"pvr_mean   = {pvr_mean}")
print(f"pvr_std    = {pvr_std_from_ci:.10f}")
print()
print(f"mc_n       = {n}")
print(f"mc_mean    = {mean:.2f}")
print(f"mc_m2      = {m2:.4e}   (M2 = (n-1)×var)")
print(f"derived_std= {std:,.2f}  (should be ≈ CI cum_std)")
print()
print(f"CI cum_std = {ci_last['cumulative_std_dev']:,.2f}")
print(f"Diff       = {(std - ci_last['cumulative_std_dev']) / ci_last['cumulative_std_dev'] * 100:.4f}%")
print()
print(f"last_date  = {ci_last['date']}")
print()
print("=== SQL for INSERT into rb_bands_state ===")
print(f"""
INSERT INTO lth_pvr.rb_bands_state
  (org_id, pvr_mean, pvr_std, mc_n, mc_mean, mc_m2, seeded_at, last_date)
SELECT
  o.org_id,
  {pvr_mean},
  {pvr_std_from_ci:.10f},
  {n},
  {mean:.2f},
  {m2:.4e},
  NOW(),
  '{ci_last['date']}'::date
FROM (SELECT DISTINCT org_id FROM lth_pvr.ci_bands_daily LIMIT 1) o
ON CONFLICT (org_id) DO NOTHING;
""")
