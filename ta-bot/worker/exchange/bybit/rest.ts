// Bybit V5 REST client. Docs: https://bybit-exchange.github.io/docs/v5/intro
import { ExchangeError, type ExchangeCredentials } from "../types.ts";
import { hmacSha256Hex, sleep } from "../util.ts";
import { BYBIT_URLS } from "./mapping.ts";
import { logger } from "../../log.ts";

const log = logger("bybit.rest");
const RECV_WINDOW = "5000";

export interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

export class BybitRest {
  readonly baseUrl: string;

  constructor(readonly testnet: boolean, private readonly creds?: ExchangeCredentials) {
    this.baseUrl = testnet ? BYBIT_URLS.testnet.rest : BYBIT_URLS.mainnet.rest;
  }

  get hasCredentials(): boolean {
    return !!this.creds;
  }

  // ---------------------------------------------------------------- transport
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}, auth = false): Promise<T> {
    const qs = buildQuery(query);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = {};
    if (auth) Object.assign(headers, await this.signHeaders(qs));
    return await this.send<T>("GET", url, headers);
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const json = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", ...(await this.signHeaders(json)) };
    return await this.send<T>("POST", `${this.baseUrl}${path}`, headers, json);
  }

  private async signHeaders(payload: string): Promise<Record<string, string>> {
    if (!this.creds) throw new ExchangeError("Private endpoint called without credentials", "bybit");
    const ts = Date.now().toString();
    const sign = await hmacSha256Hex(this.creds.apiSecret, `${ts}${this.creds.apiKey}${RECV_WINDOW}${payload}`);
    return {
      "X-BAPI-API-KEY": this.creds.apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": sign,
      "X-BAPI-SIGN-TYPE": "2",
    };
  }

  private async send<T>(method: string, url: string, headers: Record<string, string>, body?: string): Promise<T> {
    const maxAttempts = method === "GET" ? 3 : 1; // never auto-retry order mutations
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body });
      } catch (e) {
        if (attempt < maxAttempts) {
          await sleep(300 * attempt);
          continue;
        }
        throw new ExchangeError(`Network error: ${(e as Error).message}`, "bybit");
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        log.warn("retrying", { status: res.status, url, attempt });
        await res.body?.cancel();
        await sleep(500 * attempt);
        continue;
      }
      const text = await res.text();
      let env: BybitEnvelope<T>;
      try {
        env = JSON.parse(text);
      } catch {
        throw new ExchangeError(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`, "bybit", res.status);
      }
      if (!res.ok) throw new ExchangeError(`HTTP ${res.status}: ${env.retMsg ?? text}`, "bybit", res.status, env);
      if (env.retCode !== 0) throw new ExchangeError(`${env.retMsg} (retCode ${env.retCode})`, "bybit", env.retCode, env);
      return env.result;
    }
  }

  // ---------------------------------------------------------------- public
  getInstrumentsInfo(category = "linear", cursor?: string) {
    return this.get<{ list: BybitInstrument[]; nextPageCursor: string }>("/v5/market/instruments-info", {
      category,
      limit: 1000,
      cursor,
    });
  }

  /** Returns raw kline rows, NEWEST FIRST as Bybit sends them. */
  getKline(symbol: string, interval: string, start?: number, end?: number, limit = 1000, category = "linear") {
    return this.get<{ list: string[][] }>("/v5/market/kline", { category, symbol, interval, start, end, limit });
  }

  getTickers(symbol?: string, category = "linear") {
    return this.get<{ list: Record<string, string>[] }>("/v5/market/tickers", { category, symbol });
  }

  getServerTime() {
    return this.get<{ timeSecond: string; timeNano: string }>("/v5/market/time");
  }

  // ---------------------------------------------------------------- private
  getWalletBalance(accountType = "UNIFIED") {
    return this.get<{ list: BybitWallet[] }>("/v5/account/wallet-balance", { accountType }, true);
  }

  getPositionList(symbol?: string, settleCoin = "USDT", category = "linear") {
    return this.get<{ list: BybitPosition[] }>(
      "/v5/position/list",
      symbol ? { category, symbol } : { category, settleCoin },
      true,
    );
  }

  getOpenOrders(symbol?: string, settleCoin = "USDT", category = "linear") {
    return this.get<{ list: BybitOrder[] }>(
      "/v5/order/realtime",
      symbol ? { category, symbol, openOnly: 0 } : { category, settleCoin, openOnly: 0 },
      true,
    );
  }

  createOrder(body: Record<string, unknown>) {
    return this.post<{ orderId: string; orderLinkId: string }>("/v5/order/create", { category: "linear", ...body });
  }

  cancelOrder(body: { symbol: string; orderId?: string; orderLinkId?: string }) {
    return this.post<{ orderId: string; orderLinkId: string }>("/v5/order/cancel", { category: "linear", ...body });
  }

  async setLeverage(symbol: string, leverage: number) {
    const lev = String(leverage);
    try {
      await this.post("/v5/position/set-leverage", { category: "linear", symbol, buyLeverage: lev, sellLeverage: lev });
    } catch (e) {
      // 110043 = leverage not modified (already at this value) — not an error for us
      if (e instanceof ExchangeError && e.code === 110043) return;
      throw e;
    }
  }

  setTradingStop(body: Record<string, unknown>) {
    return this.post("/v5/position/trading-stop", { category: "linear", positionIdx: 0, ...body });
  }
}

function buildQuery(q: Record<string, string | number | undefined>): string {
  return Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

// ---------------------------------------------------------------- raw shapes (subset)
export interface BybitInstrument {
  symbol: string;
  contractType: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string;
  leverageFilter: { minLeverage: string; maxLeverage: string; leverageStep: string };
  priceFilter: { minPrice: string; maxPrice: string; tickSize: string };
  lotSizeFilter: { maxOrderQty: string; minOrderQty: string; qtyStep: string; minNotionalValue?: string };
}

export interface BybitWallet {
  accountType: string;
  totalEquity: string;
  totalWalletBalance: string;
  totalAvailableBalance: string; // empty string on UTA 2.0
  totalMarginBalance: string;
  totalInitialMargin: string;
  coin: {
    coin: string;
    equity: string;
    walletBalance: string;
    availableToWithdraw: string;
    locked: string;
    totalOrderIM: string;
    totalPositionIM: string;
    unrealisedPnl: string;
    usdValue: string;
  }[];
}

export interface BybitPosition {
  symbol: string;
  side: "Buy" | "Sell" | "";
  size: string;
  avgPrice: string;
  leverage: string;
  unrealisedPnl: string;
  stopLoss: string;
  takeProfit: string;
  markPrice: string;
  liqPrice: string;
  positionIdx: number;
  updatedTime: string;
}

export interface BybitOrder {
  symbol: string;
  orderId: string;
  orderLinkId: string;
  side: "Buy" | "Sell";
  orderType: "Limit" | "Market";
  price: string;
  qty: string;
  cumExecQty: string;
  avgPrice: string;
  triggerPrice: string;
  reduceOnly: boolean;
  orderStatus: string;
  updatedTime: string;
}
