"""One-off (2026-11-05 incident): route every Edge Function's Supabase key read through _shared/supabaseKeys.ts.

Replaces  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") / ("SECRET_KEY") / ("Secret Key")  ->  getServiceKey()
          Deno.env.get("SUPABASE_ANON_KEY") / ("SUPABASE_PUBLISHABLE_KEY")              ->  getPublishableKey()
collapses the resulting  getServiceKey() ?? getServiceKey()  chains, and adds the import after the last import
statement (or at the top). Line endings and encoding are preserved. Skips _shared/supabaseKeys.ts and adminAuth.ts.

    python tools/migrate_service_key_reads.py           # dry run — prints per-file counts
    python tools/migrate_service_key_reads.py --apply
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "supabase" / "functions"
APPLY = "--apply" in sys.argv
SKIP = {ROOT / "_shared" / "supabaseKeys.ts", ROOT / "_shared" / "adminAuth.ts"}

SVC = re.compile(r'''Deno\.env\.get\(\s*["'](?:SUPABASE_SERVICE_ROLE_KEY|SECRET_KEY|Secret Key|SB_SERVICE_ROLE_KEY)["']\s*\)''')
PUB = re.compile(r'''Deno\.env\.get\(\s*["'](?:SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY)["']\s*\)''')
COLLAPSE_SVC = re.compile(r'getServiceKey\(\)(\s*(?:\?\?|\|\|)\s*getServiceKey\(\))+')
COLLAPSE_PUB = re.compile(r'getPublishableKey\(\)(\s*(?:\?\?|\|\|)\s*getPublishableKey\(\))+')
IMPORT_LINE = re.compile(r'^(import\s[^\n]*?;|import\s[^\n]*?from\s+["\'][^"\']+["\'];?)\s*$', re.M)

total_files = total_svc = total_pub = 0
for path in sorted(ROOT.rglob("*.ts")):
    if path in SKIP or "node_modules" in path.parts:
        continue
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    n_svc = len(SVC.findall(text)); n_pub = len(PUB.findall(text))
    if not n_svc and not n_pub:
        continue
    new = SVC.sub("getServiceKey()", text)
    new = PUB.sub("getPublishableKey()", new)
    new = COLLAPSE_SVC.sub("getServiceKey()", new)
    new = COLLAPSE_PUB.sub("getPublishableKey()", new)
    names = [n for n, used in (("getServiceKey", n_svc), ("getPublishableKey", n_pub)) if used]
    rel = "./supabaseKeys.ts" if path.parent.name == "_shared" else "../_shared/supabaseKeys.ts"
    imp = f'import {{ {", ".join(names)} }} from "{rel}";'
    if "supabaseKeys.ts" not in new:
        # insert after the last top-of-file import statement (multi-line imports end with `from "...";`)
        last = None
        for m in re.finditer(r'^import[\s\S]*?from\s+["\'][^"\']+["\'];?[ \t]*$|^import\s+["\'][^"\']+["\'];?[ \t]*$', new, re.M):
            last = m
        if last:
            new = new[: last.end()] + nl + imp + new[last.end():]
        else:
            new = imp + nl + new
    total_files += 1; total_svc += n_svc; total_pub += n_pub
    print(f"{path.relative_to(ROOT).as_posix():60} svc={n_svc:2} pub={n_pub:2}")
    if APPLY:
        path.write_bytes(new.encode("utf-8"))

print(f"\n{'applied' if APPLY else 'dry run'}: {total_files} files, {total_svc} service-key reads, {total_pub} publishable-key reads")
