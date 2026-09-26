// Ops: TCP reachability check from wherever the worker runs.
// Usage: deno run --allow-net --allow-env worker/cli/nettest.ts [host:port ...]
const targets = Deno.args.length ? Deno.args : [
  (() => {
    try {
      const u = new URL(Deno.env.get("DATABASE_URL") ?? "");
      return `${u.hostname}:${u.port || 5432}`;
    } catch {
      return "aws-0-ap-southeast-2.pooler.supabase.com:5432";
    }
  })(),
  "api.bybit.com:443",
  "stream.bybit.com:443",
];

for (const t of targets) {
  const [hostname, portStr] = t.split(":");
  const port = Number(portStr ?? 443);
  const started = Date.now();
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 10s")), 10_000));
  try {
    const conn = await Promise.race([Deno.connect({ hostname: hostname!, port }), timeout]);
    conn.close();
    console.log(`OK    ${t}  ${Date.now() - started} ms`);
  } catch (e) {
    console.log(`FAIL  ${t}  ${(e as Error).message}`);
  }
}
