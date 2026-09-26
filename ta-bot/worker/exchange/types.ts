// Exchange-agnostic contracts. Every venue (Bybit first; Binance/VALR later) implements ExchangeAdapter.

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export interface Candle {
  exchange: string;
  symbol: string;
  timeframe: Timeframe;
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
  confirmed: boolean;
}

export interface Instrument {
  exchange: string;
  symbol: string;
  tvSymbol: string;
  category: "linear" | "inverse" | "spot";
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  qtyStep: number;
  minQty: number;
  maxQty?: number;
  minNotional?: number;
  maxLeverage?: number;
  status: string;
  raw: unknown;
}

export interface Balance {
  currency: string;
  equity: number;
  walletBalance: number;
  available: number;
  raw: unknown;
}

export type PositionSide = "long" | "short" | "flat";

export interface Position {
  symbol: string;
  side: PositionSide;
  qty: number;
  avgEntry: number;
  leverage?: number;
  unrealisedPnl?: number;
  stopLoss?: number;
  takeProfit?: number;
  markPrice?: number;
  liqPrice?: number;
  updatedAt?: Date;
  raw: unknown;
}

export interface PlaceOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  qty: number;
  price?: number;
  orderLinkId: string; // idempotency key; unique per exchange account
  reduceOnly?: boolean;
  timeInForce?: "GTC" | "PostOnly" | "IOC";
  takeProfit?: number;
  stopLoss?: number;
}

export interface PlaceOrderResult {
  exchangeOrderId: string;
  orderLinkId: string;
  raw: unknown;
}

export type OrderStatus = "new" | "submitted" | "partially_filled" | "filled" | "cancelled" | "rejected";

export interface OrderUpdate {
  symbol: string;
  exchangeOrderId: string;
  orderLinkId: string;
  side: "buy" | "sell";
  status: OrderStatus;
  qty: number;
  filledQty: number;
  avgPrice?: number;
  price?: number;
  reduceOnly: boolean;
  updatedAt: Date;
  raw: unknown;
}

export interface ExecutionUpdate {
  symbol: string;
  exchangeOrderId: string;
  orderLinkId: string;
  execId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  feeAsset?: string;
  isMaker: boolean;
  executedAt: Date;
  raw: unknown;
}

export interface OpenOrder {
  symbol: string;
  exchangeOrderId: string;
  orderLinkId: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  qty: number;
  filledQty: number;
  price?: number;
  triggerPrice?: number;
  reduceOnly: boolean;
  status: OrderStatus;
  raw: unknown;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface KlineSubscription {
  symbol: string;
  timeframe: Timeframe;
}

export interface PrivateStreamHandlers {
  onOrder?: (u: OrderUpdate) => void;
  onExecution?: (u: ExecutionUpdate) => void;
  onPosition?: (p: Position) => void;
  onWallet?: (b: Balance) => void;
}

export type Unsubscribe = () => void;

export interface ExchangeAdapter {
  readonly name: string;
  readonly testnet: boolean;

  // ---- public market data ----
  getInstruments(): Promise<Instrument[]>;
  /** Confirmed + forming klines in [startMs, endMs], ascending by openTime. */
  getKlines(symbol: string, tf: Timeframe, startMs: number, endMs: number, limit?: number): Promise<Candle[]>;
  subscribeKlines(subs: KlineSubscription[], onCandle: (c: Candle) => void): Promise<Unsubscribe>;

  // ---- private (require credentials) ----
  getBalance(): Promise<Balance>;
  getPositions(symbol?: string): Promise<Position[]>;
  getOpenOrders(symbol?: string): Promise<OpenOrder[]>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(symbol: string, ref: { exchangeOrderId?: string; orderLinkId?: string }): Promise<void>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setPositionStops(symbol: string, stops: { stopLoss?: number; takeProfit?: number }): Promise<void>;
  subscribePrivate(handlers: PrivateStreamHandlers): Promise<Unsubscribe>;
}

export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly exchange: string,
    public readonly code?: string | number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ExchangeError";
  }
}
