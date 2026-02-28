import type { IncomingMessage, ServerResponse } from "node:http";

// Binance REST — BTC/USDT current price
const BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";

interface BinanceTickerResponse {
  symbol: string;
  price: string;
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const upstream = await fetch(BINANCE_URL);
    if (!upstream.ok) throw new Error(`Binance HTTP ${upstream.status}`);

    const data = (await upstream.json()) as BinanceTickerResponse;
    const price = parseFloat(data.price);
    if (isNaN(price)) throw new Error("Invalid BTC price from Binance");

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.end(JSON.stringify({ price }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
