// Bybit TESTNET round-trip: balance → set leverage → place far-from-market post-only LIMIT →
// confirm in open orders → cancel → confirm gone. Verifies signing + private endpoints.
// Usage: deno task smoke [--symbol BTCUSDT]
import { loadConfig } from "../config.ts";
import { createExchange } from "../exchange/registry.ts";
import { floorToStep } from "../exchange/util.ts";
import { sleep } from "../exchange/util.ts";

const cfg = loadConfig();
if (!cfg.BYBIT_TESTNET_API_KEY || !cfg.BYBIT_TESTNET_API_SECRET) {
  console.error("Set BYBIT_TESTNET_API_KEY / BYBIT_TESTNET_API_SECRET in .env");
  Deno.exit(2);
}
const i = Deno.args.indexOf("--symbol");
const symbol = i >= 0 ? Deno.args[i + 1]! : "BTCUSDT";

const ex = createExchange("bybit", {
  testnet: true,
  creds: { apiKey: cfg.BYBIT_TESTNET_API_KEY, apiSecret: cfg.BYBIT_TESTNET_API_SECRET },
});

const bal = await ex.getBalance();
console.log("balance", { equity: bal.equity, available: bal.available });

const inst = (await ex.getInstruments()).find((x) => x.symbol === symbol);
if (!inst) throw new Error(`instrument ${symbol} not found`);

const [tick] = await ex.getKlines(symbol, "1m", Date.now() - 120_000, Date.now(), 2);
const last = tick?.close ?? 0;
if (!last) throw new Error("no price");

await ex.setLeverage(symbol, 2);
console.log("leverage set to 2x");

// 20 % below market so it can never fill; smallest allowed qty.
const price = floorToStep(last * 0.8, inst.tickSize);
const qty = Math.max(inst.minQty, floorToStep((inst.minNotional ?? 5) * 1.2 / price, inst.qtyStep));
const orderLinkId = `smoke-${Date.now()}`;
const placed = await ex.placeOrder({ symbol, side: "buy", type: "limit", qty, price, orderLinkId, timeInForce: "PostOnly" });
console.log("placed", placed.exchangeOrderId, { qty, price });

await sleep(1000);
const open = await ex.getOpenOrders(symbol);
const mine = open.find((o) => o.orderLinkId === orderLinkId);
console.log(mine ? "visible in open orders" : "NOT visible in open orders (check)", mine?.status);

await ex.cancelOrder(symbol, { orderLinkId });
await sleep(1000);
const after = await ex.getOpenOrders(symbol);
console.log(after.some((o) => o.orderLinkId === orderLinkId) ? "STILL OPEN — cancel failed" : "cancelled OK");

const pos = await ex.getPositions(symbol);
console.log("positions", pos.map((p) => ({ symbol: p.symbol, side: p.side, qty: p.qty })));
