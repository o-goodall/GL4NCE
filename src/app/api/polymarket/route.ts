import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const FEED_TAGS = [
  { id: 100265, label: 'Geopolitics' },
  { id: 2, label: 'Politics' },
  { id: 120, label: 'Economy' },
];

interface Market {
  id: string; question: string; topOutcome: string; probability: number;
  volume: number; volume24hr: number; endDate: string; tag: string; url: string; pinned: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOutcomes(event: any): { topOutcome: string; probability: number } {
  const firstMarket = event.markets?.[0];
  if (!firstMarket) return { topOutcome: 'Yes', probability: 50 };
  let prices: number[] = [], outcomes: string[] = [];
  try { prices = typeof firstMarket.outcomePrices === 'string' ? JSON.parse(firstMarket.outcomePrices).map(Number) : (firstMarket.outcomePrices ?? []).map(Number); } catch { /* */ }
  try { outcomes = typeof firstMarket.outcomes === 'string' ? JSON.parse(firstMarket.outcomes) : (firstMarket.outcomes ?? []); } catch { /* */ }
  if (!prices.length) return { topOutcome: 'Yes', probability: 50 };
  const maxIdx = prices.indexOf(Math.max(...prices));
  return { topOutcome: outcomes[maxIdx] ?? 'Yes', probability: Math.round((prices[maxIdx] ?? 0.5) * 100) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eventToMarket(event: any, tagLabel: string, pinned = false): Market | null {
  if (!event?.id || !event?.title) return null;
  const { topOutcome, probability } = parseOutcomes(event);
  return {
    id: String(event.id), question: event.title, topOutcome, probability,
    volume: parseFloat(event.volume ?? 0), volume24hr: parseFloat(event.volume24hr ?? 0),
    endDate: event.endDate ?? '', tag: tagLabel,
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : 'https://polymarket.com', pinned,
  };
}

export async function GET(request: NextRequest) {
  try {
    const kwParam = request.nextUrl.searchParams.get('keywords');
    const keywords: string[] = kwParam ? JSON.parse(decodeURIComponent(kwParam)) : [];

    const tagFetches = FEED_TAGS.map(tag =>
      fetch(`https://gamma-api.polymarket.com/events?tag_id=${tag.id}&closed=false&limit=6&order=volume24hr&ascending=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(r => r.ok ? r.json() : []).then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: tag.label, pinned: false }))
        .catch(() => ({ events: [], label: tag.label, pinned: false }))
    );

    const kwFetches = keywords.slice(0, 4).map(kw =>
      fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=2&search=${encodeURIComponent(kw)}&order=volume24hr&ascending=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(r => r.ok ? r.json() : []).then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: kw, pinned: true }))
        .catch(() => ({ events: [], label: kw, pinned: true }))
    );

    const allResults = await Promise.allSettled([...tagFetches, ...kwFetches]);
    const seen = new Set<string>();
    const pinnedMarkets: Market[] = [], organicMarkets: Market[] = [];

    for (const result of allResults) {
      if (result.status !== 'fulfilled') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { events, label, pinned = false } = result.value as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const event of events) {
        const id = String(event.id ?? '');
        if (!id || seen.has(id)) continue;
        const vol24 = parseFloat(event.volume24hr ?? 0);
        if (!pinned && vol24 < 100) continue;
        seen.add(id);
        const market = eventToMarket(event, label, pinned);
        if (!market) continue;
        if (pinned) pinnedMarkets.push(market); else organicMarkets.push(market);
      }
    }

    organicMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    pinnedMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    const markets = [...pinnedMarkets, ...organicMarkets].slice(0, 12);
    return NextResponse.json({ markets });
  } catch {
    return NextResponse.json({ markets: [] });
  }
}
