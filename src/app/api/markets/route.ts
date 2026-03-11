import { NextResponse } from 'next/server';

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
};

async function getGold(): Promise<{ current: number; yearAgo: number; ytdPct: number } | null> {
  try {
    const res = await fetch('https://freegoldapi.com/data/latest.json', { headers: HEADERS });
    if (!res.ok) return null;
    const data: { date: string; price: number }[] = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;
    const latest = data[data.length - 1];
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const yearAgoEntry = data.reduce((closest, entry) => {
      const d = new Date(entry.date).getTime(), target = oneYearAgo.getTime(), prevD = new Date(closest.date).getTime();
      return Math.abs(d - target) < Math.abs(prevD - target) ? entry : closest;
    });
    if (!latest.price || !yearAgoEntry.price) return null;
    return { current: latest.price, yearAgo: yearAgoEntry.price, ytdPct: ((latest.price - yearAgoEntry.price) / yearAgoEntry.price) * 100 };
  } catch { return null; }
}

async function getYahooChart(ticker: string): Promise<{ current: number; yearAgo: number; ytdPct: number } | null> {
  try {
    const encoded = encodeURIComponent(ticker);
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1mo&includePrePost=false`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1mo&includePrePost=false`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok) continue;
        const d = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        const valid = closes.filter((v: number | null) => v !== null && !isNaN(v as number)) as number[];
        if (valid.length < 2) continue;
        const current = valid[valid.length - 1], yearAgo = valid[0];
        return { current, yearAgo, ytdPct: ((current - yearAgo) / yearAgo) * 100 };
      } catch { continue; }
    }
    return null;
  } catch { return null; }
}

async function getCPI(): Promise<number | null> {
  try {
    const res = await fetch('https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&mrv=2&per_page=2', { headers: HEADERS });
    if (!res.ok) return null;
    const d = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: number[] = (d?.[1] ?? []).map((r: any) => r?.value).filter((v: number | null) => v !== null && !isNaN(v as number));
    return values[0] ?? null;
  } catch { return null; }
}

export async function GET() {
  const [goldRes, spRes, cpiRes] = await Promise.allSettled([getGold(), getYahooChart('^GSPC'), getCPI()]);
  const gold = goldRes.status === 'fulfilled' ? goldRes.value : null;
  const sp500 = spRes.status === 'fulfilled' ? spRes.value : null;
  const cpiAnnual = cpiRes.status === 'fulfilled' ? cpiRes.value : null;
  return NextResponse.json({
    gold: gold ? { priceUsd: gold.current, ytdPct: gold.ytdPct } : null,
    sp500: sp500 ? { price: sp500.current, ytdPct: sp500.ytdPct } : null,
    cpiAnnual,
  });
}
