import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const FETCH_TIMEOUT_MS = 8_000;

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawMarket {
  id: string;
  question: string;
  slug: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  volume?: string | number | null;
  volumeNum?: number | null;
  active?: boolean | null;
  closed?: boolean | null;
  endDate?: string | null;
}

interface RawEvent {
  id: string;
  title: string;
  slug: string;
  markets?: RawMarket[] | null;
  tags?: Array<{ slug?: string | null; label?: string | null }> | null;
}

export interface MarketOutcome {
  label: string;
  /** Probability expressed as a percentage 0–100 */
  probability: number;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: MarketOutcome[];
  /** Trading volume in USD */
  volume: number;
  /** ISO-8601 date string — the market resolution date */
  endDate?: string;
  /** Deep-link to the market on Polymarket.com */
  url: string;
}

export interface PolymarketData {
  markets: PolymarketMarket[];
  lastUpdated: string;
}

// ── Category tags ─────────────────────────────────────────────────────────────
export type MarketCategory = "geo" | "macro" | "crypto";

const CATEGORY_TAGS: Record<MarketCategory, readonly string[]> = {
  geo:    ["geopolitics", "war", "ukraine", "middle-east", "nato"],
  macro:  ["federal-reserve", "economics", "interest-rates", "g7", "finance"],
  crypto: ["crypto", "bitcoin", "ethereum", "defi"],
};

// ── In-memory cache (per category) ────────────────────────────────────────────
const cache = new Map<MarketCategory, { data: PolymarketData; expiresAt: number }>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseMarket(market: RawMarket, eventSlug: string): PolymarketMarket | null {
  try {
    const outcomesArr = parseJsonArray(market.outcomes);
    const pricesArr = parseJsonArray(market.outcomePrices);
    if (outcomesArr.length === 0) return null;

    const outcomes: MarketOutcome[] = outcomesArr.map((label, i) => ({
      label: String(label),
      probability: Math.round(parseFloat(String(pricesArr[i] ?? "0")) * 100),
    }));

    const rawVol =
      market.volumeNum ??
      (typeof market.volume === "number"
        ? market.volume
        : parseFloat(String(market.volume ?? "0")));
    const volume = isNaN(rawVol) ? 0 : Math.round(rawVol);

    return {
      id: market.id,
      question: market.question,
      outcomes,
      volume,
      endDate: market.endDate ?? undefined,
      url: `https://polymarket.com/event/${eventSlug}`,
    };
  } catch {
    return null;
  }
}

async function fetchEventsForTag(tag: string): Promise<RawEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GAMMA_API_BASE}/events?limit=20&closed=false&tag_slug=${encodeURIComponent(tag)}`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (!res.ok) return [];
    return (await res.json()) as RawEvent[];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMarketsForCategory(category: MarketCategory): Promise<PolymarketMarket[]> {
  const tags = CATEGORY_TAGS[category];
  const seen = new Set<string>();
  const markets: PolymarketMarket[] = [];

  // Fan out in parallel — one request per tag, fastest-first merge
  const results = await Promise.allSettled(
    tags.map((tag) => fetchEventsForTag(tag)),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      if (!event.markets) continue;
      for (const rawMarket of event.markets) {
        if (rawMarket.closed === true || rawMarket.active === false) continue;
        if (seen.has(rawMarket.id)) continue;
        const parsed = parseMarket(rawMarket, event.slug);
        if (parsed) {
          seen.add(rawMarket.id);
          markets.push(parsed);
        }
      }
    }
  }

  // Most-traded markets first so the tile shows the most-relevant predictions
  markets.sort((a, b) => b.volume - a.volume);
  return markets.slice(0, 20);
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const raw = url.searchParams.get("category") ?? "geo";
    const validCategories = Object.keys(CATEGORY_TAGS) as MarketCategory[];
    const category: MarketCategory = validCategories.includes(raw as MarketCategory)
      ? (raw as MarketCategory)
      : "geo";

    const cached = cache.get(category);
    if (cached && Date.now() < cached.expiresAt) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
      res.end(JSON.stringify(cached.data));
      return;
    }

    const markets = await fetchMarketsForCategory(category);
    const data: PolymarketData = { markets, lastUpdated: new Date().toISOString() };
    cache.set(category, { data, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.end(JSON.stringify(data));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message, markets: [] }));
  }
}
