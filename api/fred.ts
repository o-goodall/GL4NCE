import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

// ── FRED API proxy ─────────────────────────────────────────────────────────────
// Proxies requests to the FRED (Federal Reserve Economic Data) API so that:
//   1. The API key is never shipped in the browser bundle.
//   2. Responses are cached at the CDN edge for 1 hour.
//
// Usage: GET /api/fred?series=WALCL
//
// The FRED_API_KEY environment variable must be set in Vercel.
// A free key is available at https://research.stlouisfed.org/docs/api/api_key.html

const FRED_API_KEY  = process.env.FRED_API_KEY ?? "";
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

// Only the series IDs used by MoneyPrinter are allowed through this proxy.
const ALLOWED_SERIES = new Set(["WALCL", "ECBASSETSW", "RNUASSET"]);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { query } = parse(req.url ?? "", true);
  const series = typeof query.series === "string" ? query.series : "";

  if (!ALLOWED_SERIES.has(series)) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid or missing series parameter" }));
    return;
  }

  if (!FRED_API_KEY) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "FRED_API_KEY environment variable is not configured" }));
    return;
  }

  try {
    const url =
      `${FRED_BASE_URL}` +
      `?series_id=${encodeURIComponent(series)}` +
      `&api_key=${FRED_API_KEY}` +
      `&limit=260&sort_order=desc&file_type=json`;

    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`FRED HTTP ${upstream.status}`);

    const data = await upstream.text();

    res.setHeader("Content-Type", "application/json");
    // Cache for 24 hours; FRED weekly series update at most once per week.
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.end(data);
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
