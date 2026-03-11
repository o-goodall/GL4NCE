import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * /api/onchain — MVRV Z-Score + NUPL derived from CoinMetrics community API.
 *
 * Source: CoinMetrics Community v4 (free, no API key).
 *   - CapMVRVCur  = Market Cap / Realized Cap (MVRV ratio)
 *   - CapMrktCurUSD = Market cap in USD
 *
 * Derivations:
 *   RealizedCap  = MarketCap / MVRV
 *   NUPL         = 1 - 1/MVRV  = (MarketCap - RealizedCap) / MarketCap
 *   MVRV Z-Score = (MarketCap - RealizedCap) / StdDev(MarketCap)
 *
 * Returns JSON: { mvrvZScore, nupl, mvrv, marketCap, realizedCap, time }
 */

interface CmRow {
  time: string;
  CapMVRVCur: string;
  CapMrktCurUSD: string;
}

interface CmResponse {
  data: CmRow[];
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url =
      "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics" +
      "?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD&frequency=1d&page_size=10000&start_time=2011-01-01";

    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!upstream.ok) throw new Error(`CoinMetrics HTTP ${upstream.status}`);

    const json = (await upstream.json()) as CmResponse;
    const rows = json.data;
    if (!rows || rows.length < 100) throw new Error("Insufficient data from CoinMetrics");

    // Parse all rows into numeric arrays
    const marketCaps: number[] = [];
    const mvrvs: number[] = [];
    for (const row of rows) {
      const mc = parseFloat(row.CapMrktCurUSD);
      const mv = parseFloat(row.CapMVRVCur);
      if (isNaN(mc) || isNaN(mv) || mv === 0) continue;
      marketCaps.push(mc);
      mvrvs.push(mv);
    }

    if (marketCaps.length < 100) throw new Error("Too few valid data points");

    // Latest values
    const lastIdx = marketCaps.length - 1;
    const currentMC = marketCaps[lastIdx];
    const currentMVRV = mvrvs[lastIdx];
    const currentRC = currentMC / currentMVRV;

    // NUPL = 1 - 1/MVRV = (MC - RC) / MC
    const nupl = 1 - 1 / currentMVRV;

    // MVRV Z-Score = (MC - RC) / StdDev(MC)
    // StdDev computed over entire history for stability
    const meanMC = marketCaps.reduce((s, v) => s + v, 0) / marketCaps.length;
    const variance =
      marketCaps.reduce((s, v) => s + (v - meanMC) ** 2, 0) / marketCaps.length;
    const stddevMC = Math.sqrt(variance);

    const mvrvZScore = stddevMC > 0 ? (currentMC - currentRC) / stddevMC : 0;

    const lastRow = rows[rows.length - 1];

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Cache-Control",
      "s-maxage=21600, stale-while-revalidate=3600",
    ); // 6 h edge cache
    res.end(
      JSON.stringify({
        mvrvZScore: Math.round(mvrvZScore * 100) / 100,
        nupl: Math.round(nupl * 1000) / 1000,
        mvrv: Math.round(currentMVRV * 1000) / 1000,
        marketCap: Math.round(currentMC),
        realizedCap: Math.round(currentRC),
        time: lastRow.time,
      }),
    );
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
