import {
  type Balance,
  type Candle,
  type ExchangeAdapter,
  type ExchangeCredentials,
  ExchangeError,
  type ExecutionUpdate,
  type Instrument,
  type KlineSubscription,
  type OpenOrder,
  type OrderStatus,
  type OrderUpdate,
  type PlaceOrderRequest,
  type PlaceOrderResult,
  type Position,
  type PrivateStreamHandlers,
  type Timeframe,
  type Unsubscribe,
} from "../types.ts";
import { type BybitInstrument, type BybitOrder, type BybitPosition, BybitRest } from "./rest.ts";
import { BybitSocket } from "./ws.ts";
import { BYBIT_INTERVAL, BYBIT_URLS, intervalToTimeframe, toTvSymbol } from "./mapping.ts";

const EXCHANGE = "bybit";

export class BybitAdapter implements ExchangeAdapter {
  readonly name = EXCHANGE;
  private readonly rest: BybitRest;

  constructor(readonly testnet: boolean, private readonly creds?: ExchangeCredentials) {
    this.rest = new BybitRest(testnet, creds);
  }

  // ------------------------------------------------------------------ public
  async getInstruments(): Promise<Instrument[]> {
    const out: Instrument[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.rest.getInstrumentsInfo("linear", cursor);
      for (const i of page.list) {
        if (i.contractType !== "LinearPerpetual") continue;
        out.push(mapInstrument(i));
      }
      cursor = page.nextPageCursor || undefined;
    } while (cursor);
    return out;
  }

  async getKlines(symbol: string, tf: Timeframe, startMs: number, endMs: number, limit = 1000): Promise<Candle[]> {
    const res = await this.rest.getKline(symbol, BYBIT_INTERVAL[tf], startMs, endMs, limit);
    const now = Date.now();
    const tfMs = tfMillis(tf);
    return res.list
      .map((row) => rowToCandle(symbol, tf, row, now, tfMs))
      .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  }

  subscribeKlines(subs: KlineSubscription[], onCandle: (c: Candle) => void): Promise<Unsubscribe> {
    const topics = subs.map((s) => `kline.${BYBIT_INTERVAL[s.timeframe]}.${s.symbol}`);
    const sock = new BybitSocket({
      url: this.testnet ? BYBIT_URLS.testnet.wsPublicLinear : BYBIT_URLS.mainnet.wsPublicLinear,
      topics,
      label: "public-linear",
      onMessage: (msg) => {
        const topic = String(msg.topic ?? "");
        if (!topic.startsWith("kline.")) return;
        const [, interval, symbol] = topic.split(".");
        const tf = interval ? intervalToTimeframe(interval) : undefined;
        if (!tf || !symbol) return;
        for (const d of (msg.data as WsKline[] | undefined) ?? []) {
          onCandle({
            exchange: EXCHANGE,
            symbol,
            timeframe: tf,
            openTime: new Date(Number(d.start)),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume),
            turnover: Number(d.turnover),
            confirmed: d.confirm === true,
          });
        }
      },
    });
    sock.start();
    return Promise.resolve(() => sock.stop());
  }

  // ----------------------------------------------------------------- private
  async getBalance(): Promise<Balance> {
    const res = await this.rest.getWalletBalance("UNIFIED");
    const w = res.list[0];
    if (!w) throw new ExchangeError("Empty wallet response", EXCHANGE);
    return {
      currency: "USDT",
      equity: Number(w.totalEquity),
      walletBalance: Number(w.totalWalletBalance),
      available: Number(w.totalAvailableBalance),
      raw: w,
    };
  }

  async getPositions(symbol?: string): Promise<Position[]> {
    const res = await this.rest.getPositionList(symbol);
    return res.list.map(mapPosition);
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
    const res = await this.rest.getOpenOrders(symbol);
    return res.list.map(mapOpenOrder);
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (req.type === "limit" && req.price === undefined) {
      throw new ExchangeError("Limit order requires price", EXCHANGE);
    }
    const body: Record<string, unknown> = {
      symbol: req.symbol,
      side: req.side === "buy" ? "Buy" : "Sell",
      orderType: req.type === "limit" ? "Limit" : "Market",
      qty: String(req.qty),
      orderLinkId: req.orderLinkId,
      positionIdx: 0, // one-way mode
    };
    if (req.price !== undefined) body.price = String(req.price);
    if (req.timeInForce) body.timeInForce = req.timeInForce;
    if (req.reduceOnly) body.reduceOnly = true;
    if (req.takeProfit !== undefined || req.stopLoss !== undefined) {
      body.tpslMode = "Full";
      if (req.takeProfit !== undefined) body.takeProfit = String(req.takeProfit);
      if (req.stopLoss !== undefined) body.stopLoss = String(req.stopLoss);
      body.slTriggerBy = "MarkPrice";
      body.tpTriggerBy = "LastPrice";
    }
    const res = await this.rest.createOrder(body);
    return { exchangeOrderId: res.orderId, orderLinkId: res.orderLinkId, raw: res };
  }

  async cancelOrder(symbol: string, ref: { exchangeOrderId?: string; orderLinkId?: string }): Promise<void> {
    if (!ref.exchangeOrderId && !ref.orderLinkId) throw new ExchangeError("cancelOrder needs an id", EXCHANGE);
    await this.rest.cancelOrder({ symbol, orderId: ref.exchangeOrderId, orderLinkId: ref.orderLinkId });
  }

  setLeverage(symbol: string, leverage: number): Promise<void> {
    return this.rest.setLeverage(symbol, leverage);
  }

  async setPositionStops(symbol: string, stops: { stopLoss?: number; takeProfit?: number }): Promise<void> {
    const body: Record<string, unknown> = { symbol, tpslMode: "Full" };
    if (stops.stopLoss !== undefined) {
      body.stopLoss = String(stops.stopLoss);
      body.slTriggerBy = "MarkPrice";
    }
    if (stops.takeProfit !== undefined) {
      body.takeProfit = String(stops.takeProfit);
      body.tpTriggerBy = "LastPrice";
    }
    await this.rest.setTradingStop(body);
  }

  subscribePrivate(handlers: PrivateStreamHandlers): Promise<Unsubscribe> {
    if (!this.creds) throw new ExchangeError("subscribePrivate requires credentials", EXCHANGE);
    const topics: string[] = [];
    if (handlers.onOrder) topics.push("order");
    if (handlers.onExecution) topics.push("execution");
    if (handlers.onPosition) topics.push("position");
    if (handlers.onWallet) topics.push("wallet");
    const sock = new BybitSocket({
      url: this.testnet ? BYBIT_URLS.testnet.wsPrivate : BYBIT_URLS.mainnet.wsPrivate,
      topics,
      creds: this.creds,
      label: "private",
      onMessage: (msg) => {
        const topic = String(msg.topic ?? "");
        const data = (msg.data as Record<string, string>[] | undefined) ?? [];
        if (topic === "order") data.forEach((d) => handlers.onOrder?.(mapOrderUpdate(d)));
        else if (topic === "execution") data.forEach((d) => handlers.onExecution?.(mapExecution(d)));
        else if (topic === "position") data.forEach((d) => handlers.onPosition?.(mapPosition(d as unknown as BybitPosition)));
        else if (topic === "wallet") {
          data.forEach((d) =>
            handlers.onWallet?.({
              currency: "USDT",
              equity: Number(d.totalEquity),
              walletBalance: Number(d.totalWalletBalance),
              available: Number(d.totalAvailableBalance),
              raw: d,
            })
          );
        }
      },
    });
    sock.start();
    return Promise.resolve(() => sock.stop());
  }
}

// ---------------------------------------------------------------- mappers
interface WsKline {
  start: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
  confirm: boolean;
}

function tfMillis(tf: Timeframe): number {
  return { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[tf];
}

function rowToCandle(symbol: string, tf: Timeframe, row: string[], nowMs: number, tfMs: number): Candle {
  const openTime = Number(row[0]);
  return {
    exchange: EXCHANGE,
    symbol,
    timeframe: tf,
    openTime: new Date(openTime),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    turnover: Number(row[6]),
    confirmed: openTime + tfMs <= nowMs,
  };
}

function mapInstrument(i: BybitInstrument): Instrument {
  return {
    exchange: EXCHANGE,
    symbol: i.symbol,
    tvSymbol: toTvSymbol(i.symbol, "linear"),
    category: "linear",
    baseAsset: i.baseCoin,
    quoteAsset: i.quoteCoin,
    tickSize: Number(i.priceFilter.tickSize),
    qtyStep: Number(i.lotSizeFilter.qtyStep),
    minQty: Number(i.lotSizeFilter.minOrderQty),
    maxQty: Number(i.lotSizeFilter.maxOrderQty),
    minNotional: i.lotSizeFilter.minNotionalValue ? Number(i.lotSizeFilter.minNotionalValue) : undefined,
    maxLeverage: Number(i.leverageFilter.maxLeverage),
    status: i.status,
    raw: i,
  };
}

function mapPosition(p: BybitPosition): Position {
  const qty = Number(p.size);
  return {
    symbol: p.symbol,
    side: qty === 0 || p.side === "" ? "flat" : p.side === "Buy" ? "long" : "short",
    qty,
    avgEntry: Number(p.avgPrice),
    leverage: Number(p.leverage) || undefined,
    unrealisedPnl: Number(p.unrealisedPnl) || 0,
    stopLoss: Number(p.stopLoss) || undefined,
    takeProfit: Number(p.takeProfit) || undefined,
    markPrice: Number(p.markPrice) || undefined,
    liqPrice: Number(p.liqPrice) || undefined,
    updatedAt: p.updatedTime ? new Date(Number(p.updatedTime)) : undefined,
    raw: p,
  };
}

function mapStatus(s: string): OrderStatus {
  switch (s) {
    case "New":
    case "Untriggered":
      return "submitted";
    case "PartiallyFilled":
      return "partially_filled";
    case "Filled":
      return "filled";
    case "Cancelled":
    case "PartiallyFilledCanceled":
    case "Deactivated":
      return "cancelled";
    case "Rejected":
      return "rejected";
    default:
      return "submitted";
  }
}

function mapOpenOrder(o: BybitOrder): OpenOrder {
  return {
    symbol: o.symbol,
    exchangeOrderId: o.orderId,
    orderLinkId: o.orderLinkId,
    side: o.side === "Buy" ? "buy" : "sell",
    type: o.orderType === "Limit" ? "limit" : "market",
    qty: Number(o.qty),
    filledQty: Number(o.cumExecQty),
    price: Number(o.price) || undefined,
    triggerPrice: Number(o.triggerPrice) || undefined,
    reduceOnly: !!o.reduceOnly,
    status: mapStatus(o.orderStatus),
    raw: o,
  };
}

function mapOrderUpdate(d: Record<string, string>): OrderUpdate {
  return {
    symbol: d.symbol ?? "",
    exchangeOrderId: d.orderId ?? "",
    orderLinkId: d.orderLinkId ?? "",
    side: d.side === "Buy" ? "buy" : "sell",
    status: mapStatus(d.orderStatus ?? ""),
    qty: Number(d.qty),
    filledQty: Number(d.cumExecQty),
    avgPrice: Number(d.avgPrice) || undefined,
    price: Number(d.price) || undefined,
    reduceOnly: String(d.reduceOnly) === "true",
    updatedAt: new Date(Number(d.updatedTime)),
    raw: d,
  };
}

function mapExecution(d: Record<string, string>): ExecutionUpdate {
  return {
    symbol: d.symbol ?? "",
    exchangeOrderId: d.orderId ?? "",
    orderLinkId: d.orderLinkId ?? "",
    execId: d.execId ?? "",
    side: d.side === "Buy" ? "buy" : "sell",
    qty: Number(d.execQty),
    price: Number(d.execPrice),
    fee: Number(d.execFee),
    feeAsset: d.feeCurrency || undefined,
    isMaker: String(d.isMaker) === "true",
    executedAt: new Date(Number(d.execTime)),
    raw: d,
  };
}
