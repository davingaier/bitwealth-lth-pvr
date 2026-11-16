"""
BitWealth off-platform backups — Storage bucket export + logical database dump, AES-256 encrypted.

Usage (normally driven by tools/backup/run_backup.ps1, which supplies the secrets):
    python tools/backup/backup.py storage            # export every Storage bucket -> Backups/storage/storage_<ts>.zip
    python tools/backup/backup.py db                 # pg_dump (custom format) + cron jobs + manifest -> Backups/db/db_<ts>.zip
    python tools/backup/backup.py all                # both
    python tools/backup/backup.py verify <zip>       # open an archive with the passphrase and CRC-check its contents
    python tools/backup/backup.py extract <zip> [--dest DIR]   # decrypt + unpack (no 7-Zip needed)
    python tools/backup/backup.py restore-storage <zip> [--bucket NAME] [--dry-run]
                                                     # re-upload objects from a storage archive into the project
                                                     # named by SUPABASE_URL (use against a NEW project after a disaster)

Environment (all required for storage/db; see run_backup.ps1 -Action setup):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage API + alert_events heartbeat
    DATABASE_URL                              session-mode Postgres URL (port 5432), used by pg_dump / psycopg
    BACKUP_PASSPHRASE                         AES-256 passphrase for the archives (keep in Infisical + password manager)
Optional:
    BACKUP_ROOT          default %USERPROFILE%\\Dropbox\\BitWealth\\Backups
    BACKUP_KEEP_DB       weekly DB archives to keep (default 12 ≈ 3 months)
    BACKUP_KEEP_STORAGE  weekly storage archives to keep (default 8 ≈ 2 months)
    BACKUP_NO_ALERT=1    do not write to public.alert_events
    ORG_ID               org uuid stamped on alert rows
    PG_DUMP / PG_RESTORE explicit paths if not on PATH

Archive format: standard ZIP with WinZip AES-256 entries (pyzipper) — 7-Zip / WinZip open it with the passphrase.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

import httpx
import pyzipper

COMPONENT = "backup_job"
DEFAULT_ORG_ID = "b0a77009-03b9-44a1-ae1d-34f157d44a8b"
UA = "bitwealth-backup/1.0"

# Platform-owned schemas that a) the postgres role cannot fully read, b) are recreated by Supabase on a new project,
# or c) must never be in a backup (vault). cron is excluded as a schema; cron.job is exported separately as CSV.
EXCLUDED_SCHEMAS = [
    "extensions", "graphql", "graphql_public", "net", "pgbouncer", "pgsodium", "pgsodium_masks", "pgtle",
    "realtime", "supabase_functions", "supabase_migrations", "vault", "_analytics", "_realtime", "cron", "pgmq",
]
# Tables whose row counts are recorded in the manifest so a restore can be sanity-checked quickly.
MANIFEST_COUNT_TABLES = [
    "public.customer_details", "public.exchange_accounts", "public.customer_strategies", "public.organizations",
    "lth_pvr.decisions_daily", "lth_pvr.order_intents", "lth_pvr.exchange_orders", "lth_pvr.order_fills",
    "lth_pvr.ledger_lines", "lth_pvr.balances_daily", "lth_pvr.exchange_funding_events",
    "sth_cb.decisions_daily", "sth_cb.tracker_daily", "auth.users", "storage.objects",
]


def log(msg: str) -> None:
    print(f"{dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        raise SystemExit(f"missing environment variable {name}")
    return v or ""


def backup_root() -> Path:
    root = os.environ.get("BACKUP_ROOT") or str(Path.home() / "Dropbox" / "BitWealth" / "Backups")
    p = Path(root)
    for sub in ("db", "storage", "logs"):
        (p / sub).mkdir(parents=True, exist_ok=True)
    return p


def stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d_%H%M%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def passphrase() -> bytes:
    p = env("BACKUP_PASSPHRASE")
    if len(p) < 16:
        raise SystemExit("BACKUP_PASSPHRASE is too short (min 16 chars)")
    return p.encode("utf-8")


def open_archive_for_write(path: Path) -> pyzipper.AESZipFile:
    zf = pyzipper.AESZipFile(path, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES)
    zf.setpassword(passphrase())
    return zf


def open_archive_for_read(path: Path) -> pyzipper.AESZipFile:
    zf = pyzipper.AESZipFile(path, "r")
    zf.setpassword(passphrase())
    return zf


# ----------------------------------------------------------------------------------------------------------------
# Supabase HTTP helpers
# ----------------------------------------------------------------------------------------------------------------
def sb_headers() -> dict[str, str]:
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": key, "Authorization": f"Bearer {key}", "User-Agent": UA}


def sb_client() -> httpx.Client:
    return httpx.Client(base_url=env("SUPABASE_URL").rstrip("/"), headers=sb_headers(), timeout=httpx.Timeout(120.0))


def post_alert(severity: str, message: str, context: dict) -> None:
    """Heartbeat / failure row in public.alert_events so backups are visible in the Admin UI and the daily digest."""
    if os.environ.get("BACKUP_NO_ALERT") == "1":
        return
    try:
        with sb_client() as c:
            r = c.post(
                "/rest/v1/alert_events",
                headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
                json={
                    "component": COMPONENT,
                    "severity": severity,
                    "message": message,
                    "context": context,
                    "org_id": os.environ.get("ORG_ID") or DEFAULT_ORG_ID,
                },
            )
            if r.status_code >= 300:
                log(f"WARN alert_events insert failed: {r.status_code} {r.text[:200]}")
    except Exception as e:  # never let alerting break the backup
        log(f"WARN alert_events insert raised: {e}")


# ----------------------------------------------------------------------------------------------------------------
# Storage export
# ----------------------------------------------------------------------------------------------------------------
def list_buckets(c: httpx.Client) -> list[dict]:
    r = c.get("/storage/v1/bucket")
    r.raise_for_status()
    return r.json()


def list_objects(c: httpx.Client, bucket: str, prefix: str = "") -> list[dict]:
    """Recursive listing. The list endpoint returns folders as entries with id=None."""
    out: list[dict] = []
    offset = 0
    while True:
        r = c.post(
            f"/storage/v1/object/list/{bucket}",
            json={"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
        )
        r.raise_for_status()
        rows = r.json()
        for row in rows:
            name = f"{prefix}{row['name']}" if prefix else row["name"]
            if row.get("id") is None:
                out.extend(list_objects(c, bucket, name + "/"))
            else:
                row["full_path"] = name
                out.append(row)
        if len(rows) < 1000:
            break
        offset += len(rows)
    return out


def download_object(c: httpx.Client, bucket: str, path: str) -> bytes:
    r = c.get(f"/storage/v1/object/{bucket}/{quote(path)}")
    r.raise_for_status()
    return r.content


def run_storage() -> dict:
    root = backup_root()
    out = root / "storage" / f"storage_{stamp()}.zip"
    manifest: dict = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "supabase_url": env("SUPABASE_URL"),
                      "buckets": []}
    total_bytes = 0
    total_objects = 0
    workers = int(os.environ.get("BACKUP_WORKERS", "8"))
    with sb_client() as c, open_archive_for_write(out) as zf, ThreadPoolExecutor(max_workers=workers) as pool:
        for b in list_buckets(c):
            bucket = b["id"]
            objs = list_objects(c, bucket)
            log(f"storage: bucket {bucket} ({'public' if b.get('public') else 'private'}) {len(objs)} objects")
            entries = []
            # Each request is ~1 s of round-trip latency; download in parallel, write to the zip in order.
            for i in range(0, len(objs), workers * 4):
                batch = objs[i:i + workers * 4]
                blobs = list(pool.map(lambda o: download_object(c, bucket, o["full_path"]), batch))
                for o, data in zip(batch, blobs):
                    zf.writestr(f"{bucket}/{o['full_path']}", data)
                    meta = o.get("metadata") or {}
                    entries.append({
                        "path": o["full_path"], "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "content_type": meta.get("mimetype"), "updated_at": o.get("updated_at"), "id": o.get("id"),
                    })
                    total_bytes += len(data)
                    total_objects += 1
            manifest["buckets"].append({"id": bucket, "public": bool(b.get("public")), "objects": entries})
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    size = out.stat().st_size
    log(f"storage: wrote {out} ({size/1e6:.1f} MB, {total_objects} objects, {total_bytes/1e6:.1f} MB raw)")
    verify_archive(out, expect_entries=total_objects + 1)
    pruned = prune(root / "storage", "storage_*.zip", int(os.environ.get("BACKUP_KEEP_STORAGE", "8")))
    return {"file": str(out), "bytes": size, "objects": total_objects, "raw_bytes": total_bytes, "pruned": pruned,
            "sha256": sha256_file(out)}


def run_restore_storage(zip_path: Path, only_bucket: str | None, dry_run: bool) -> None:
    with sb_client() as c, open_archive_for_read(zip_path) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        existing = {b["id"]: b for b in list_buckets(c)}
        for b in manifest["buckets"]:
            if only_bucket and b["id"] != only_bucket:
                continue
            if b["id"] not in existing:
                log(f"restore: creating bucket {b['id']} (public={b['public']})")
                if not dry_run:
                    r = c.post("/storage/v1/bucket", json={"id": b["id"], "name": b["id"], "public": b["public"]})
                    r.raise_for_status()
            for o in b["objects"]:
                arc = f"{b['id']}/{o['path']}"
                log(f"restore: {'would upload' if dry_run else 'upload'} {arc} ({o['size']} B)")
                if dry_run:
                    continue
                data = zf.read(arc)
                headers = {"x-upsert": "true"}
                if o.get("content_type"):
                    headers["Content-Type"] = o["content_type"]
                r = c.post(f"/storage/v1/object/{b['id']}/{quote(o['path'])}", content=data, headers=headers)
                if r.status_code >= 300:
                    raise RuntimeError(f"upload failed {arc}: {r.status_code} {r.text[:200]}")
    log("restore: done")


# ----------------------------------------------------------------------------------------------------------------
# Database dump
# ----------------------------------------------------------------------------------------------------------------
def session_mode_url(url: str) -> str:
    """pg_dump needs a session-mode connection; swap the transaction pooler port (6543) for 5432."""
    u = urlparse(url)
    if u.port == 6543:
        return urlunparse(u._replace(netloc=u.netloc.replace(":6543", ":5432")))
    return url


def find_tool(name: str) -> str:
    explicit = os.environ.get(name.upper())
    if explicit and Path(explicit).exists():
        return explicit
    found = shutil.which(name)
    if found:
        return found
    scoop = Path.home() / "scoop" / "apps" / "postgresql" / "current" / "bin" / f"{name}.exe"
    if scoop.is_file():
        return str(scoop)
    pf = Path(r"C:\Program Files\PostgreSQL")
    if pf.is_dir():
        hits = sorted(pf.glob(f"*/bin/{name}.exe"))
        if hits:
            return str(hits[-1])
    raise SystemExit(f"{name} not found — install PostgreSQL client tools (scoop install postgresql) or set {name.upper()}")


def db_manifest(url: str) -> tuple[dict, str]:
    """Row counts + server info via psycopg, and cron.job as CSV (the cron schema is excluded from the dump)."""
    import psycopg

    info: dict = {"counts": {}}
    with psycopg.connect(url, connect_timeout=30) as conn:
        conn.execute("set statement_timeout = '120s'")
        info["server_version"] = conn.execute("show server_version").fetchone()[0]
        info["db_size_bytes"] = conn.execute("select pg_database_size(current_database())").fetchone()[0]
        for t in MANIFEST_COUNT_TABLES:
            try:
                info["counts"][t] = conn.execute(f"select count(*) from {t}").fetchone()[0]
            except Exception as e:
                conn.rollback()
                info["counts"][t] = f"error: {str(e).splitlines()[0]}"
        info["max_ledger_trade_date"] = str(conn.execute("select max(trade_date) from lth_pvr.ledger_lines").fetchone()[0])
        buf = io.StringIO()
        with conn.cursor().copy(
            "copy (select jobid, jobname, schedule, command, nodename, database, username, active "
            "from cron.job order by jobid) to stdout with (format csv, header)"
        ) as cp:
            for chunk in cp:
                buf.write(bytes(chunk).decode("utf-8"))
        cron_csv = buf.getvalue()
    return info, cron_csv


def run_db() -> dict:
    root = backup_root()
    url = session_mode_url(env("DATABASE_URL"))
    pg_dump = find_tool("pg_dump")
    pg_restore = find_tool("pg_restore")
    ts = stamp()
    out = root / "db" / f"db_{ts}.zip"
    tmpdir = Path(tempfile.mkdtemp(prefix="bw_backup_"))
    try:
        dump = tmpdir / f"db_{ts}.dump"
        cmd = [pg_dump, "--format=custom", "--compress=6", "--no-password", "--verbose", f"--file={dump}"]
        cmd += [f"--exclude-schema={s}" for s in EXCLUDED_SCHEMAS]
        cmd.append(url)
        log(f"db: running {Path(pg_dump).name} (excluding {len(EXCLUDED_SCHEMAS)} platform schemas)")
        t0 = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if proc.returncode != 0:
            tail = "\n".join(proc.stderr.strip().splitlines()[-40:])
            raise RuntimeError(f"pg_dump exit {proc.returncode}:\n{tail}")
        warnings = [l for l in proc.stderr.splitlines() if "warning" in l.lower() or "error" in l.lower()]
        log(f"db: pg_dump finished in {time.time()-t0:.0f}s, {dump.stat().st_size/1e6:.1f} MB, {len(warnings)} warnings")
        for w in warnings[:10]:
            log(f"db:   {w}")

        # The TOC must be readable — the cheapest "is this dump valid" check.
        toc = subprocess.run([pg_restore, "--list", str(dump)], capture_output=True, text=True, encoding="utf-8",
                             errors="replace")
        if toc.returncode != 0:
            raise RuntimeError(f"pg_restore --list failed: {toc.stderr[-500:]}")
        toc_entries = len([l for l in toc.stdout.splitlines() if l and not l.startswith(";")])
        log(f"db: dump TOC ok ({toc_entries} entries)")

        info, cron_csv = db_manifest(url)
        manifest = {
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "supabase_url": env("SUPABASE_URL", required=False),
            "pg_dump_version": subprocess.run([pg_dump, "--version"], capture_output=True, text=True).stdout.strip(),
            "excluded_schemas": EXCLUDED_SCHEMAS, "toc_entries": toc_entries,
            "dump_file": dump.name, "dump_bytes": dump.stat().st_size, "dump_sha256": sha256_file(dump),
            "pg_dump_warnings": warnings, **info,
        }
        with open_archive_for_write(out) as zf:
            # pg_dump already compressed the dump — store it, encrypt only
            zf.write(dump, dump.name, compress_type=pyzipper.ZIP_STORED)
            zf.writestr("cron_jobs.csv", cron_csv)
            zf.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
            zf.writestr("RESTORE.txt", RESTORE_NOTES)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    size = out.stat().st_size
    log(f"db: wrote {out} ({size/1e6:.1f} MB)")
    verify_archive(out, expect_entries=4)
    pruned = prune(root / "db", "db_*.zip", int(os.environ.get("BACKUP_KEEP_DB", "12")))
    return {"file": str(out), "bytes": size, "toc_entries": toc_entries, "counts": info["counts"],
            "max_ledger_trade_date": info["max_ledger_trade_date"], "pruned": pruned, "sha256": sha256_file(out)}


RESTORE_NOTES = """BitWealth database archive - how to restore (full runbook: docs/BACKUP_AND_RESTORE.md in the repo)

1. Decrypt: run_backup.ps1 -Action extract -Path <this zip>  (or 7-Zip with the BACKUP_PASSPHRASE).
   Files: db_<ts>.dump (pg_dump custom format), cron_jobs.csv, manifest.json (row counts to compare after restore).
2. Restore the WHOLE dump - it already excludes Supabase platform schemas. Do NOT add --schema= filters
   (pg_restore then omits CREATE SCHEMA and everything inside fails):
     pg_restore --no-owner --no-privileges --jobs=4 -d "<session-mode DATABASE_URL>" db_<ts>.dump
   New Supabase project: expect only "already exists" errors for pre-created auth/storage/public objects.
   Vanilla Postgres (local drill): first run tools/backup/restore_drill_prep.sql (roles + extensions schema), then
   expect ~10 errors about pg_cron / pg_net / http / supabase_vault not being available - harmless.
3. Then: compare counts with manifest.json; recreate cron jobs from cron_jobs.csv; re-add Vault / Edge Function
   secrets; redeploy edge functions; restore Storage objects with
     python tools/backup/backup.py restore-storage <storage zip>
4. To recover a few rows into the LIVE project: restore into a local Postgres and copy rows across -
   never pg_restore straight over production.
"""


# ----------------------------------------------------------------------------------------------------------------
# Verify / prune
# ----------------------------------------------------------------------------------------------------------------
def verify_archive(path: Path, expect_entries: int | None = None) -> list[str]:
    with open_archive_for_read(path) as zf:
        names = zf.namelist()
        bad = zf.testzip()  # decrypts + CRC-checks every member
        if bad:
            raise RuntimeError(f"archive {path} failed CRC on {bad}")
        if expect_entries is not None and len(names) != expect_entries:
            raise RuntimeError(f"archive {path} has {len(names)} entries, expected {expect_entries}")
        if "manifest.json" in names:
            json.loads(zf.read("manifest.json"))
    log(f"verify: {path.name} ok ({len(names)} entries, AES-256, CRC verified)")
    return names


def prune(folder: Path, pattern: str, keep: int) -> list[str]:
    files = sorted(folder.glob(pattern))
    victims = files[:-keep] if keep > 0 and len(files) > keep else []
    for f in victims:
        f.unlink()
        log(f"prune: removed {f.name}")
    return [f.name for f in victims]


# ----------------------------------------------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["storage", "db", "all", "verify", "extract", "restore-storage"])
    ap.add_argument("path", nargs="?", help="archive path for verify / extract / restore-storage")
    ap.add_argument("--dest", help="extract: destination folder (default: next to the archive)")
    ap.add_argument("--bucket", help="restore-storage: only this bucket")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    if a.action == "verify":
        if not a.path:
            ap.error("verify needs an archive path")
        for n in verify_archive(Path(a.path)):
            print("  ", n)
        return 0
    if a.action == "extract":
        if not a.path:
            ap.error("extract needs an archive path")
        src = Path(a.path)
        dest = Path(a.dest) if a.dest else src.with_suffix("")
        dest.mkdir(parents=True, exist_ok=True)
        with open_archive_for_read(src) as zf:
            zf.extractall(dest)
            log(f"extract: {len(zf.namelist())} entries -> {dest}")
        return 0
    if a.action == "restore-storage":
        if not a.path:
            ap.error("restore-storage needs an archive path")
        run_restore_storage(Path(a.path), a.bucket, a.dry_run)
        return 0

    jobs = ["storage", "db"] if a.action == "all" else [a.action]
    results: dict = {}
    failed = False
    for job in jobs:
        t0 = time.time()
        try:
            results[job] = (run_storage if job == "storage" else run_db)()
            results[job]["seconds"] = round(time.time() - t0)
            log(f"{job}: OK in {results[job]['seconds']}s")
        except Exception as e:
            failed = True
            results[job] = {"error": str(e)[-1500:], "seconds": round(time.time() - t0)}
            log(f"{job}: FAILED — {e}")
            traceback.print_exc()
    parts = []
    for j, r in results.items():
        parts.append(f"{j}: FAILED" if "error" in r else f"{j}: {Path(r['file']).name} ({r['bytes']/1e6:.0f} MB)")
    summary = ", ".join(parts)
    post_alert("error" if failed else "info",
               f"Off-platform backup {'FAILED' if failed else 'completed'} — {summary}",
               {"host": os.environ.get("COMPUTERNAME"), "backup_root": str(backup_root()), **results})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
