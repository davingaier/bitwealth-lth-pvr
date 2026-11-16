# Backups & Restore — BitWealth

**Owner:** Davin · **Introduced:** 2026-11-16 (SDD v0.6.218) · **Scripts:** [`tools/backup/`](../tools/backup/)

This document explains what is backed up, where it goes, what it costs, and — most importantly — how to get the data
back. A backup that has never been restored is a hope, not a backup: see §6 for the annual restore drill.

---

## 1. The three layers

| Layer | What | Cadence | Retention | Where | Who runs it |
|---|---|---|---|---|---|
| **A. Supabase daily backups** (platform) | Full physical snapshot of the Postgres database | Daily (automatic) | 7 days (Pro plan) | Supabase-managed S3, `ap-southeast-2` (Sydney), encrypted at rest | Supabase — cannot be disabled or deleted via the app |
| **B. Off-platform database dump** (ours) | `pg_dump` of every application schema + `auth` + `storage` metadata + `cron.job` list, AES-256 encrypted | Weekly, Monday 08:30 SAST | Last 12 archives (≈ 3 months) | `Dropbox\BitWealth\Backups\db\` → Dropbox cloud | Windows scheduled task on Davin's PC |
| **C. Off-platform Storage export** (ours) | Every object in every Storage bucket (`kyc-documents`, `customer-statements`, `support-attachments`, `public-web`, `branding`) + manifest, AES-256 encrypted | Weekly, Monday 08:00 SAST | Last 8 archives (≈ 2 months) | `Dropbox\BitWealth\Backups\storage\` → Dropbox cloud | Windows scheduled task on Davin's PC |

**Why B and C exist when A already exists**

- *7 days is short.* If a data-corruption bug (or a hostile actor) went unnoticed for eight days, layer A would have
  nothing clean left. Layer B keeps ~3 months.
- *Layer A is inside the same trust boundary.* An attacker who gained full control of the Supabase account could
  delete the project and its backups together. Layers B/C are in a different account (Dropbox) on different hardware.
- *Storage objects are not in A at all.* Supabase's database backup covers only the metadata rows in
  `storage.objects`; the actual KYC PDFs/ID photos live in object storage and are **not** included. Layer C is the only
  copy of those files other than the live bucket.

**What is deliberately NOT backed up**

- `vault.secrets` (VALR API keys, edge auth header) — the vault is encrypted with a project key that a new project does
  not have, and secrets must never sit in a file on a laptop. They live in Infisical (+ VALR can re-issue). After a
  restore you re-enter them (§5 step 6).
- `cron.job_run_details` (2.9 GB of job logs), Supabase-internal schemas (`extensions`, `realtime`, `net`, `graphql`,
  `supabase_functions`, `pgsodium`, …) — recreated automatically by a new project.
- Edge function source — it is in Git (`supabase/functions/`); redeploy with `tools/redeploy_all_functions.ps1`.
- The website — Git + Netlify.

---

## 2. How the scripts work

```
tools/backup/backup.py        Python; does the work (httpx + psycopg + pyzipper + pg_dump/pg_restore)
tools/backup/run_backup.ps1   PowerShell wrapper; holds credentials (DPAPI), registers the scheduled tasks, logs
%LOCALAPPDATA%\BitWealth\backup.cred   DPAPI-encrypted JSON: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                                       BACKUP_PASSPHRASE — readable ONLY by Davin's Windows account on this PC
Dropbox\BitWealth\Backups\{db,storage,logs}
```

**Storage export (`backup.py storage`)** — lists every bucket through the Storage API (service key), walks every folder,
downloads every object, writes them into one ZIP with WinZip-AES-256 entries, adds `manifest.json` (bucket, path,
size, SHA-256, content-type, updated_at per object), then re-opens the archive with the passphrase and CRC-checks
every member before declaring success. Prunes to the newest 8.

**Database dump (`backup.py db`)** — runs `pg_dump --format=custom --compress=6` over a session-mode connection
(port 5432; a 6543 pooler URL is rewritten automatically), excluding the platform schemas listed above; checks the
dump's table-of-contents with `pg_restore --list`; records row counts of the 15 key tables, the server version, the
DB size and `max(trade_date)` of the ledger in `manifest.json`; exports `cron.job` as `cron_jobs.csv`; adds a
`RESTORE.txt`; stores everything in one AES-256 ZIP; CRC-verifies it; prunes to the newest 12.

**Heartbeat / alerting** — every run (success *or* failure) inserts a row into `public.alert_events` with
`component='backup_job'`: severity `info` on success (visible in Admin UI → Administration → Alerts), `error` on
failure (also emailed by the 05:00 UTC `ef_alert_digest`). The context JSON carries file name, size, SHA-256, row
counts and duration. **If you stop seeing a weekly `backup_job` info row, the PC was off or the task is broken — check
`run_backup.ps1 -Action show`.**

**Encryption** — standard ZIP container with AES-256 (WinZip AE-2) entries, so 7-Zip / WinZip / `backup.py verify`
can open it with the passphrase. The passphrase is 36 random base-64 characters (~215 bits); it is the single thing
that makes the Dropbox copies safe to exist. Without it the archives are noise; with it anyone can read customer
documents and the full ledger. Keep it in **Infisical (`BACKUP_PASSPHRASE`) and your password manager** — never in
Git, chat or the repo.

**Why DPAPI and not Infisical for the scheduled task** — the Infisical CLI session expires and re-authenticates via a
browser, which a scheduled task cannot do. DPAPI needs nothing interactive; the blob is bound to this Windows user on
this PC (useless if copied elsewhere). The trade-off: anyone who can run code as Davin on this PC can read the
backup credentials — the same trust already placed in this PC by Infisical login and the Dropbox client.

---

## 3. Day-to-day operations

```powershell
# status: recent archives, task state, last result, credential file present?
.\tools\backup\run_backup.ps1 -Action show

# run on demand (no Infisical needed)
.\tools\backup\run_backup.ps1 -Action storage
.\tools\backup\run_backup.ps1 -Action db
.\tools\backup\run_backup.ps1 -Action all

# open/verify an archive (decrypt + CRC every member, list contents)
.\tools\backup\run_backup.ps1 -Action verify -Path "$env:USERPROFILE\Dropbox\BitWealth\Backups\db\db_2026-11-16_135500Z.zip"

# reveal the passphrase from the credential file (private terminal only)
.\tools\backup\run_backup.ps1 -Action passphrase

# re-seed credentials after a key rotation (needs Infisical; keeps the existing passphrase)
infisical login
.\tools\with-secrets.ps1 pwsh -NoProfile -File tools\backup\run_backup.ps1 -Action setup
```

Logs: `Dropbox\BitWealth\Backups\logs\backup_<job>_<ts>.log` (last 40 kept). Scheduled tasks: Task Scheduler Library
→ **BitWealth** → *Backup Storage (weekly)*, *Backup Database (weekly)*. They run only when the PC is on and Davin is
logged in; a missed run starts as soon as the PC is next available ("Run task as soon as possible after a scheduled
start is missed" is on). To run while logged out, open the task → *Run whether user is logged on or not* (Windows
asks for the account password; DPAPI still works because it is the same user).

**After rotating the Supabase secret key or the DB password:** re-run setup (above) or the next backup fails with 401
/ auth error — which you will see as an `error` alert.

---

## 4. Costs

| Item | Cost | Note |
|---|---|---|
| Supabase daily backups (layer A) | **$0** | Included in the Pro plan ($25/mo already paid) |
| Egress for layers B + C | **$0** | Pro includes 250 GB/month uncached egress; a full dump is ~0.5–1.5 GB and the bucket export ~30 MB → ≈ 2–6 GB/month, well inside the quota ($0.09/GB only above 250 GB) |
| Dropbox space | **$0 extra** | ~12 × dump + 8 × storage ≈ 4–8 GB on the existing plan; shrink `BACKUP_KEEP_DB` if space is tight |
| PostgreSQL client tools (`scoop install postgresql`) | $0 | pg_dump/pg_restore 18.x — compatible with the PG 17 server |
| **Optional:** Supabase Point-in-Time Recovery add-on | $100 / $200 / $400 per month | 7 / 14 / 28-day retention, restore to any second. Not enabled — once-daily trading makes a daily snapshot adequate; revisit if intraday writes become critical |
| **Optional:** second off-site target (Backblaze B2 / Cloudflare R2) | ≈ $0 at this size | B2: first 10 GB free then $6/TB-month; R2: 10 GB free, no egress fee. Worth adding if you ever stop trusting a single Dropbox account; `rclone` would copy `Backups\` there in one line |

So the whole scheme costs nothing beyond what is already paid; the only "price" is that Davin's PC must be switched
on sometime on a Monday.

---

## 5. Restore runbook

### 5.1 Recover a few deleted/damaged rows (most likely case)

Never `pg_restore` over production. Restore into a scratch Postgres and copy rows across. This is exactly what the
2026-11-16 drill did (≈ 3 min for the 227 MB dump):

```powershell
$pg = "$env:USERPROFILE\scoop\apps\postgresql\current"
# 1. start the local scratch server that `scoop install postgresql` created (Start-Process, NOT a pipeline:
#    pg_ctl's stdout is inherited by the server and a piped call never returns; -Wait would hang for the same reason)
Start-Process "$pg\bin\pg_ctl.exe" -ArgumentList @('-D', "`"$pg\data`"", '-o', '"-p 5499"', 'start') -WindowStyle Hidden
& "$pg\bin\pg_isready.exe" -h 127.0.0.1 -p 5499          # it listens on IPv4 only - always use 127.0.0.1, not localhost
& "$pg\bin\psql.exe" -h 127.0.0.1 -p 5499 -U postgres -d postgres -c "create database bw_restore;"
& "$pg\bin\psql.exe" -h 127.0.0.1 -p 5499 -U postgres -d bw_restore -f tools\backup\restore_drill_prep.sql   # Supabase roles + extensions schema
# 2. decrypt + unpack the archive
.\tools\backup\run_backup.ps1 -Action extract -Path <db zip> -Dest $env:TEMP\bw_restore
# 3. FULL restore (do NOT use --schema=...: pg_restore then omits the CREATE SCHEMA itself and 600 objects fail)
& "$pg\bin\pg_restore.exe" --no-owner --no-privileges --jobs=4 -d "postgresql://postgres@127.0.0.1:5499/bw_restore" "$env:TEMP\bw_restore\db_<ts>.dump"
#    expect ~10 errors, all "extension pg_cron / pg_net / http / supabase_vault is not available" + their event
#    triggers - Supabase-only, harmless here. Anything else is a real problem.
# 4. compare with manifest.json, then export what you need
& "$pg\bin\psql.exe" -h 127.0.0.1 -p 5499 -U postgres -d bw_restore -c "select count(*) from lth_pvr.ledger_lines"
& "$pg\bin\psql.exe" -h 127.0.0.1 -p 5499 -U postgres -d bw_restore -c "copy (select * from lth_pvr.ledger_lines where customer_id=65 and trade_date='2026-11-10') to stdout csv header" > rows.csv
# 5. insert into production through the Admin UI / an audited SQL migration - not a blind COPY
# 6. CLEAN UP - the scratch DB now holds every customer's data unencrypted on this laptop
& "$pg\bin\psql.exe" -h 127.0.0.1 -p 5499 -U postgres -d postgres -c "drop database bw_restore;"
Start-Process "$pg\bin\pg_ctl.exe" -ArgumentList @('-D', "`"$pg\data`"", 'stop', '-m', 'fast') -WindowStyle Hidden
Remove-Item "$env:TEMP\bw_restore" -Recurse -Force
```

### 5.2 Recover a Storage object (deleted KYC document / statement)

```powershell
# list what the archive holds
.\tools\backup\run_backup.ps1 -Action verify -Path <storage zip>
# re-upload one bucket (or all) into the project in SUPABASE_URL (upsert; existing objects are overwritten)
.\tools\backup\run_backup.ps1 -Action passphrase          # if needed for 7-Zip
.\tools\with-secrets.ps1 python tools\backup\backup.py restore-storage <storage zip> --bucket kyc-documents --dry-run
.\tools\with-secrets.ps1 python tools\backup\backup.py restore-storage <storage zip> --bucket kyc-documents
```
(or just unzip with 7-Zip and drag the file back in via the Supabase dashboard).

### 5.3 Roll the whole database back ≤ 7 days

Use **layer A**: Supabase Dashboard → Database → Backups → pick the day → Restore. This *replaces* the live database
(the dashboard warns you). Pause `pg_cron` jobs first (`update cron.job set active=false`) and re-enable afterwards so
the pipeline does not trade on stale state. Storage objects are unaffected.

### 5.4 Disaster: the Supabase project is gone / unrecoverable

1. **Freeze:** kill-switch `settings.withdrawals_enabled=false` is moot (no DB) — instead revoke the VALR API keys in
   the VALR console so nothing can trade until the platform is back.
2. **New project** in Supabase (same region), note the new `project-ref`, DB password, secret + publishable keys.
3. **Schema + data:** decrypt the newest `db_*.zip` (`run_backup.ps1 -Action extract`) and run, from a session-mode
   URL of the new project, a **full** restore (the dump already excludes every platform schema; never add
   `--schema=` filters — pg_restore then skips the `CREATE SCHEMA` statements and everything inside them fails):
   ```powershell
   pg_restore --no-owner --no-privileges --jobs=4 -d "<new DATABASE_URL>" db_<ts>.dump
   ```
   Expect "already exists" errors for the `auth` / `storage` / `public` objects and extensions that Supabase
   pre-creates, and nothing else; the data `COPY`s into `auth.users` / `storage.objects` still run (every customer's
   login + password hash and the document metadata that step 5 fills). Compare row counts with `manifest.json`.
   If `auth`/`storage` data `COPY`s fail on conflicts, re-run just those with
   `pg_restore --data-only --disable-triggers --schema=auth --schema=storage` (data-only with `--schema` is fine).
4. **Grants / roles:** run `.\tools\with-secrets.ps1 python tools\audit_rpc_guards.py` and the latest hardening
   migrations if anything in `supabase/migrations` is newer than the dump.
5. **Storage objects:** `python tools/backup/backup.py restore-storage <newest storage zip>` with `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` pointing at the new project (creates missing buckets, upserts every object).
6. **Secrets:** Vault (`lth_pvr.valr_sign` secrets, `ef_auth_header`, `ef_base_url`) and Edge Function secrets
   (`SB_SECRET_KEY`, `RESEND_API_KEY`, `RECAPTCHA_SECRET_KEY`, `ORG_ID`, …) — values from Infisical / newly issued VALR
   keys. Follow `docs/SECURITY_RUNBOOK.md` §5.
7. **Edge functions:** `.\tools\redeploy_all_functions.ps1` against the new project-ref.
8. **Cron:** recreate jobs from `cron_jobs.csv` (`select cron.schedule(jobname, schedule, command)` per row). Do this
   *last* — cron starts trading as soon as it exists.
9. **Front-ends:** update the project URL + publishable key constants in `website/*.html` and the Admin UI; Netlify
   redeploys on push. Update `netlify.toml` CSP `connect-src` with the new project host.
10. **Verify** a customer login, a portal balance, the Admin UI pipeline status, then re-issue VALR keys and re-enable
    trading.

RPO (how much you can lose): ≤ 24 h with layer A, ≤ 7 days with layer B alone. RTO (how long to be back): realistic
half a day for 5.4, minutes for 5.1–5.3.

---

## 6. Restore drill (do this once a year, or after big schema changes)

Run §5.1 with the newest archives (local Postgres), check the row counts against `manifest.json`, then drop the
scratch database. Every year or two, also do §5.4 steps 3 and 5 into a free-tier Supabase project and log in as a
test customer before deleting it. Record the date and outcome in the SDD change log.

| Date | Archive | Result |
|---|---|---|
| 2026-11-16 | `db_2026-11-16_140433Z.zip` (227 MB, 2,968 TOC entries) | ✅ Full restore into local PG 18 in 169 s; 187 tables; all 10 manifest counts matched exactly (incl. `auth.users` 20, `storage.objects` 101, max ledger 2026-11-14); 10 errors, all Supabase-only extensions. Found and fixed two runbook mistakes (`--schema` filter drops `CREATE SCHEMA`; `localhost` → `::1` vs IPv4-only server). |

---

## 7. Known limits & gotchas

- **The PC must be on.** The tasks catch up at next logon, but a PC left off for two Mondays means a two-week gap. The
  `backup_job` heartbeat alert makes that visible; consider the Backblaze/R2 + GitHub Actions route if the PC becomes
  unreliable (that would require putting the DB password in GitHub secrets — a trade-off to make consciously).
- **Dropbox selective sync / online-only.** `Backups\` must stay synced (not "online-only" on this PC, and not excluded
  from sync) or the archives are only local.
- **Secret-key rotation** breaks the job until `setup` is re-run (visible as an `error` alert).
- **pg_dump 18 → server 17**: fine. Never dump with a client *older* than the server.
- **`--exclude-schema` means `cron.job` is only in `cron_jobs.csv`**, not in the dump.
- **Never restore with `--schema=X` filters** (except `--data-only`): pg_restore omits the `CREATE SCHEMA` and every
  object inside fails with "schema does not exist". Restore the whole dump - it already contains only our schemas.
- **Local scratch server:** IPv4 only (`-h 127.0.0.1`); start/stop `pg_ctl` via `Start-Process` without `-Wait`.
- **The drill leaves plaintext customer data on the laptop** until you `drop database` and delete the extracted
  folder - §5.1 step 6 is not optional.
- **Storage export is a full copy each week** (~30 MB today). If the buckets grow past a few GB, switch to
  incremental (compare `updated_at`/SHA-256 against the previous manifest).
- **Egress spikes:** a full dump counts toward the 250 GB/month quota. Running `db` manually several times a day for
  weeks would eventually cost money; the weekly task will not.
