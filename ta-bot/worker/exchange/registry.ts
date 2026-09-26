import type { ExchangeAdapter, ExchangeCredentials } from "./types.ts";
import { BybitAdapter } from "./bybit/adapter.ts";

export type ExchangeName = "bybit";

export function createExchange(
  name: string,
  opts: { testnet: boolean; creds?: ExchangeCredentials },
): ExchangeAdapter {
  switch (name) {
    case "bybit":
      return new BybitAdapter(opts.testnet, opts.creds);
    default:
      throw new Error(`Unsupported exchange: ${name}`);
  }
}
