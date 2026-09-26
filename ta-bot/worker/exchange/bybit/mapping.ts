import type { Timeframe } from "../types.ts";

export const BYBIT_INTERVAL: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

const REVERSE: Record<string, Timeframe> = Object.fromEntries(
  Object.entries(BYBIT_INTERVAL).map(([tf, iv]) => [iv, tf as Timeframe]),
);

export function intervalToTimeframe(interval: string): Timeframe | undefined {
  return REVERSE[interval];
}

export const BYBIT_URLS = {
  mainnet: {
    rest: "https://api.bybit.com",
    wsPublicLinear: "wss://stream.bybit.com/v5/public/linear",
    wsPrivate: "wss://stream.bybit.com/v5/private",
  },
  testnet: {
    rest: "https://api-testnet.bybit.com",
    wsPublicLinear: "wss://stream-testnet.bybit.com/v5/public/linear",
    wsPrivate: "wss://stream-testnet.bybit.com/v5/private",
  },
} as const;

/** Bybit perpetual symbol → TradingView symbol, e.g. BTCUSDT → BYBIT:BTCUSDT.P */
export function toTvSymbol(symbol: string, category: string): string {
  return category === "spot" ? `BYBIT:${symbol}` : `BYBIT:${symbol}.P`;
}

/** TradingView symbol → Bybit native symbol. Accepts BYBIT:BTCUSDT.P, BYBIT:BTCUSDT, BTCUSDT.P, BTCUSDT */
export function fromTvSymbol(tv: string): string {
  const noPrefix = tv.includes(":") ? tv.split(":")[1]! : tv;
  return noPrefix.replace(/\.P$/i, "").toUpperCase();
}
