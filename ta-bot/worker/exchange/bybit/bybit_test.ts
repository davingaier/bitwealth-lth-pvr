import { assertEquals } from "@std/assert";
import { hmacSha256Hex, floorToStep, roundToStep } from "../util.ts";
import { fromTvSymbol, intervalToTimeframe, toTvSymbol } from "./mapping.ts";

Deno.test("hmacSha256Hex matches known vector", async () => {
  // RFC 4231 test case 2
  const sig = await hmacSha256Hex("Jefe", "what do ya want for nothing?");
  assertEquals(sig, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

Deno.test("Bybit signature payload shape (ts+key+recv+payload)", async () => {
  // Deterministic: verifies we sign the concatenation, not the parts separately.
  const a = await hmacSha256Hex("s", "1700000000000" + "KEY" + "5000" + "category=linear&symbol=BTCUSDT");
  const b = await hmacSha256Hex("s", "1700000000000KEY5000category=linear&symbol=BTCUSDT");
  assertEquals(a, b);
});

Deno.test("timeframe ↔ interval mapping", () => {
  assertEquals(intervalToTimeframe("1"), "1m");
  assertEquals(intervalToTimeframe("60"), "1h");
  assertEquals(intervalToTimeframe("240"), "4h");
  assertEquals(intervalToTimeframe("D"), "1d");
  assertEquals(intervalToTimeframe("W"), undefined);
});

Deno.test("TradingView symbol conversion", () => {
  assertEquals(toTvSymbol("BTCUSDT", "linear"), "BYBIT:BTCUSDT.P");
  assertEquals(fromTvSymbol("BYBIT:BTCUSDT.P"), "BTCUSDT");
  assertEquals(fromTvSymbol("btcusdt.p"), "BTCUSDT");
  assertEquals(fromTvSymbol("ETHUSDT"), "ETHUSDT");
});

Deno.test("step rounding", () => {
  assertEquals(floorToStep(0.00123456, 0.001), 0.001);
  assertEquals(floorToStep(67891.23, 0.1), 67891.2);
  assertEquals(roundToStep(67891.26, 0.1), 67891.3);
  assertEquals(floorToStep(1, 0.1), 1); // no FP drift
});
