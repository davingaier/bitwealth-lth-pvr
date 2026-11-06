# BitWealth Security Runbook

_Last updated 2026-11-05 after the service-role key incident. Written for the operator (no developer knowledge assumed).
Steps marked **[me]** are yours; everything else is already in code._

---

## 0. What changed today (so you know the new rules)

| Before | Now |
|---|---|
| One Supabase "service_role" JWT key used everywhere, could not be rotated | Opaque `sb_secret_…` keys; legacy JWT keys **disabled** |
| Dozens of pipeline functions answered anyone who called them | Every function checks the caller (secret key or signed-in admin) |
| VALR API secrets inside Edge Function environment and returned by a database function | VALR secrets live **only in Supabase Vault**; the database signs requests and never hands the secret out |
| Anyone with the service key could queue a withdrawal that paid out automatically | New crypto destinations are **held for your approval**; velocity cap; global kill-switch; alert on every withdrawal |
| Nothing watched credential reads | Critical alert if credentials for ≥ 8 customers are read in 10 min |
| Alerts were emailed once a day | Critical **security** alerts are emailed **immediately** |
| `.env` with every secret sat in Dropbox | `.env` moved out of Dropbox (and should go into a secrets manager — §5) |

---

## 1. [me] Finish the VALR side (do this when VALR reopens your account)

**1a. Create two API keys instead of one** (VALR → Profile → API Keys → *Add API Key*):

| Key | Permissions to tick | Permissions to leave OFF | Used for |
|---|---|---|---|
| `BitWealth Trading` | View, Trade, **Subaccount transfers** | **Withdraw** | all daily pipeline work (orders, polls, sweeps, fee transfers) |
| `BitWealth Withdraw` | View, **Withdraw** | Trade | customer withdrawals only |

Enable **"Allow withdrawals only to whitelisted addresses"** on the account and add your own cold-wallet / bank
destinations. With no Withdraw permission on the trading key, a stolen trading key cannot move money off VALR.

> Don't bother with VALR IP allow-listing: Supabase Edge Functions have no fixed outbound IP, so it would break the pipeline.

**1b. Put the keys in Supabase Vault (not in Edge Function secrets).**
Supabase Dashboard → **SQL Editor** → New query → paste, replace the four values, Run:

```sql
select vault.update_secret((select id from vault.secrets where name='valr_master_api_key'),     'PASTE_TRADING_KEY');
select vault.update_secret((select id from vault.secrets where name='valr_master_api_secret'),  'PASTE_TRADING_SECRET');
select vault.update_secret((select id from vault.secrets where name='valr_withdraw_api_key'),   'PASTE_WITHDRAW_KEY');
select vault.update_secret((select id from vault.secrets where name='valr_withdraw_api_secret'),'PASTE_WITHDRAW_SECRET');
-- check (prints only lengths, never values):
select name, length(decrypted_secret) chars from vault.decrypted_secrets where name like 'valr_%';
```
All four rows should show a non-zero `chars`.

**1c. Confirm the pipeline signs server-side.** After the next trading run (or ask me to trigger a balance check):
```sql
select purpose, scope, count(*) from lth_pvr.valr_credential_access_log
where accessed_at > now() - interval '1 day' group by 1,2;
```
You want rows with `purpose = sign`. If you see a critical alert titled *"Server-side VALR signature differs…"*, stop and tell me.

**1d. Remove the old secrets from the functions** (only after 1c looks good):
Dashboard → **Edge Functions → Secrets** → delete **both** `VALR_API_SECRET` and `VALR_API_KEY`. (Since 2026-11-06 every function takes the API key from Vault too; a leftover env `VALR_API_KEY` that no longer matches the Vault secret produced "invalid signature" errors on the legacy path until the code was changed to prefer Vault.)

**1e. Tell customers 9, 49 and 56** (API-model clients) to delete their BitWealth API key on VALR and create a new one;
re-enter it via Admin UI → Customer Management → Edit Client → VALR API key. Their old keys were read by the attacker.

---

## 2. [me] Supabase account hygiene (15 minutes)

**2a. Turn on MFA for your Supabase login.**
supabase.com → avatar (top-right) → **Account Settings → Security → Multi-factor authentication → Enable**. Scan the QR
with an authenticator app (Google Authenticator / Authy / Bitwarden). Save the recovery codes in your password manager.
Then **Organization → Settings → Security → Require MFA for all members**.

**2b. Turn on leaked-password protection** (the advisor flagged it):
Dashboard → **Authentication → Providers → Email → "Prevent use of leaked passwords"** → toggle on → Save.

**2c. Enable MFA on VALR** too (Profile → Security → 2FA) if not already, and on Resend and your email host.

**2d. Migrate to JWT signing keys** (so future rotations never log users out):
Dashboard → **Settings → JWT Keys → "Migrate to JWT signing keys"**. Pick **ECC (P-256)**, click *Create standby key*,
wait ~5 min, then **Rotate** to make it current. Users stay signed in. Legacy JWT secret stays as a fallback; revoke it
after a week if nothing complains. (Our functions never verify JWTs themselves — Supabase does — so no code change.)

**2e. Use separate secret keys per component** so one leak only revokes one thing:
Dashboard → **Settings → API Keys → Secret keys → Create new secret key**, named:
- `edge-functions` → this is what `SUPABASE_SECRET_KEYS` already injects — nothing to do if it exists.
- `cron` → run in SQL Editor (replace value):
  ```sql
  select vault.update_secret((select id from vault.secrets where name='service_jwt'), 'sb_secret_CRON_KEY');
  select vault.update_secret((select id from vault.secrets where name='SUPABASE_SERVICE_ROLE_KEY'), 'sb_secret_CRON_KEY');
  select vault.update_secret((select id from vault.secrets where name='ef_auth_header'), 'Bearer sb_secret_CRON_KEY');
  update lth_pvr.settings set val='Bearer sb_secret_CRON_KEY' where key='ef_auth_header';
  update private.app_secrets set value='sb_secret_CRON_KEY' where key='service_jwt';
  update app.config set value='sb_secret_CRON_KEY' where key='service_role';
  ```
- `local-tools` → goes only into your local `.env` / secrets manager (used by `tools/*.py`, lab scripts).
Then delete the single `default` key once all three are in place. The code accepts any of them automatically.

---

## 3. Withdrawal controls — how to operate them

- **Kill-switch** (stop ALL crypto withdrawals instantly), SQL Editor:
  ```sql
  update lth_pvr.settings set val='false' where key='withdrawals_enabled';   -- 'true' to re-enable
  ```
- **A customer's withdrawal is "held"** (you'll get an immediate email, status `needs_approval`). Phone/WhatsApp the
  customer to confirm the address, then either approve once:
  ```sql
  update lth_pvr.withdrawal_requests set status='pending' where request_id='<id from the email>';
  ```
  or trust the address permanently so future withdrawals flow:
  ```sql
  insert into lth_pvr.withdrawal_allowlist(org_id, customer_id, currency, address, label)
  values ((select val::uuid from lth_pvr.settings where key='org_id'), <customer_id>, 'USDT', '<address>', 'verified by phone 2026-11-05');
  ```
- **Velocity cap**: default 3 crypto withdrawals per customer per 60 min (`withdrawal_velocity_max`,
  `withdrawal_velocity_window_min` in `lth_pvr.settings`).

---

## 4. Rotation schedule (every quarter — you will get an alert email on 1 Feb / May / Aug / Nov)

1. Supabase → Settings → API Keys → create a new secret key, run the §2e SQL with the new value, then update
   Edge Function secret `SB_SECRET_KEY` if you use it; delete the old key.
2. VALR → create new Trading + Withdraw keys, run §1b SQL, delete the old keys on VALR.
3. Resend → API Keys → create, update Edge Function secret `RESEND_API_KEY`, delete old. Same for `SMTP_PASS`.
4. Update your secrets manager (§5). Mark the alert resolved in Admin UI → Administration → Alerts.

---

## 5. [me] Secrets manager — recommended free options

You have ~10 secrets across three places: Supabase Vault (runtime, already encrypted), Edge Function secrets
(runtime), and your **local `.env`** (for tools and the lab). The manager is for the third one — the file that leaked.

| Option | Free tier | Why it fits | Steps |
|---|---|---|---|
| **Infisical** (recommended) | Free cloud plan: unlimited secrets, 5 users, 3 environments; open-source | Purpose-built for `.env` replacement; one command injects secrets into any process so **no `.env` file exists on disk**; secret rotation reminders; audit log | 1. Sign up at infisical.com, create project `bitwealth`. 2. Add each `.env` line as a secret (Development env). 3. Install CLI: `winget install Infisical.CLI`. 4. In the repo folder: `infisical login` then `infisical init`. 5. Run tools as `infisical run -- python tools\valr_probe.ps1` / `infisical run -- deno run -A tools\sth_cb_lab\fetch.ts`. 6. Delete `.env`. |
| **Doppler** | Free Developer plan: unlimited projects/secrets, 5 users | Slickest UI, same `doppler run -- <command>` pattern, built-in rotation reminders | `winget install Doppler.doppler` → `doppler login` → `doppler setup` → `doppler secrets upload .env` → `doppler run -- <cmd>` |
| **Bitwarden Secrets Manager** | Free for 2 users / 3 projects / 3 machine accounts | Good if you already use Bitwarden for passwords; CLI `bws run -- <cmd>` | bitwarden.com/products/secrets-manager → create project → `bws` CLI |

Whichever you choose: put MFA on it, and **never** paste a secret into chat, Slack, WhatsApp or a Git commit again.
The `.env.example` in the repo lists the variable names you need.

### 5a. ✅ Done (2026-11-06) — Infisical is set up. What it means day to day

- **The live system does not use Infisical.** Edge Functions, cron, the Admin UI and the website read their secrets
  from Supabase (Edge Function secrets + Vault), exactly as before. Nothing about trading depends on your PC.
- **Infisical only matters for scripts run on your PC** (the back-test lab, email-template tools, `valr_probe.ps1`).
  Those are almost always run by the AI assistant during a session, using the shortcut
  `.\tools\with-secrets.ps1 <program> <args>` (= `infisical run --env dev --recursive -- <program> <args>`;
  `--recursive` is needed because your secrets are organised in folders). **You do not need to run this yourself.**
- **The only thing you do in Infisical:** when a secret changes (e.g. a VALR key rotation), update it in the Infisical
  web UI *and* in the matching Supabase place (Vault for VALR keys, Edge Function secrets for the rest). Infisical is
  the backup copy for your PC; Supabase is what the system actually runs on.
- Keep the folders — moving secrets to root would only drop the word `--recursive`, nothing else.

---

## 6. If it happens again — 10-minute containment checklist

1. VALR → Profile → Security → **Block account** (or phone VALR). Cancel pending withdrawals.
2. Supabase → Settings → API Keys → **delete the suspected secret key** (seconds; pipeline will fail-closed until step 4).
3. SQL Editor: `update lth_pvr.settings set val='false' where key='withdrawals_enabled';`
4. Create a new secret key; run §2e SQL; update Edge Function secrets.
5. Rotate VALR keys (§1a–1b), Resend, SMTP.
6. Check `public.alert_events` and `lth_pvr.valr_credential_access_log` for what was touched; Dashboard → Logs → API for the attacker's user-agent/IP.
7. Tell me — I'll trace scope and clean up.

---

## 7. Follow-ups still open (developer work)

- ~~Stage 2 of server-side signing~~ **done 2026-11-06**: every live-path function signs via Vault; `VALR_API_SECRET` removed from Edge Function secrets. Remaining: stop `get_customer_valr_credentials` returning `api_secret` once the api-model customers are re-keyed (their secrets are needed only by the signer now).
- Advisor backlog: 21 public tables without RLS, 38 SECURITY DEFINER views, ~120 functions with mutable search_path —
  needs a per-object review (some are intentionally public for the website).
- Admin UI panel for the withdrawal allow-list and held requests (today: SQL in §3).
