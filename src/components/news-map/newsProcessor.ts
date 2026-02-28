import type { NewsEvent, EventSeverity, EventCategory, CountryNewsData, NewsMapData } from "./types";
import { KEYWORD_MAP, UNIQUE_COUNTRIES } from "./countryData";

// Sorted keywords longest-first — pre-computed once to avoid repeated sorting during article processing
const SORTED_KEYWORDS = [...KEYWORD_MAP.keys()].sort((a, b) => b.length - a.length);

// Severity / category keyword lists (ordered: most severe first)
const HIGH_VIOLENT = [
  "bombing", "explosion", "suicide attack", "terrorist attack",
  "killed", "death toll", "casualties", "massacre", "murder", "homicide",
  "airstrike", "air strike", "missile strike", "drone strike",
  "arson", "fire bomb",
];
const MEDIUM_VIOLENT = [
  "shooting", "stabbing", "assault", "riot",
  "violent protest", "clashes", "street fighting", "armed confrontation",
  "hostage", "abduction", "kidnapping",
  "sabotage", "vandalism",
];
const LOW_MINOR = [
  "peaceful protest", "demonstration", "march", "worker strike",
  "civil unrest", "blockade", "curfew", "evacuation",
  "power outage", "flooding", "earthquake", "storm",
  "social unrest", "tension", "dispute",
];
const HIGH_ECONOMIC = [
  "stock market crash", "market collapse", "market plunge",
  "hyperinflation", "currency collapse", "devaluation", "economic meltdown",
  "debt default", "sovereign default", "government default",
  "banking crisis", "bank run", "financial crisis",
  "severe sanctions", "trade embargo", "trade war",
  "mass unemployment", "factory closure", "supply chain collapse",
  "food shortage", "energy crisis",
];
/** Violent attacks with a clearly identified extremist/ideological motive */
const HIGH_EXTREMISM = [
  "neo-nazi attack", "neo nazi attack", "neonazi attack",
  "white supremacist attack", "far-right attack", "far right attack",
  "far-left attack", "far left attack", "antifa attack",
  "antisemitic attack", "antisemitic shooting", "antisemitic stabbing",
  "extremist bombing", "hate crime killing", "hate crime murder",
];
/** Extremist ideology, movements, rallies, and hate-crime activity */
const MEDIUM_EXTREMISM = [
  "neo-nazi", "neo nazi", "neonazi",
  "white supremacist", "white supremacy", "white nationalist",
  "antisemitism", "antisemitic", "antisemite",
  "far-right extremist", "far right extremist",
  "far-left extremist", "far left extremist",
  "antifa", "fascist rally", "nazi rally", "nazi march",
  "hate group", "hate march", "extremist rally",
  "kkk", "ku klux klan",
  "political extremism", "radicalization", "radicalisation",
  "islamophobic attack", "islamophobia",
  "alt-right", "alt right", "proud boys", "oath keepers",
];

const TRENDING_THRESHOLD = 3;
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 };
const RETENTION_HOURS = 48;
/** "Breaking" window: events within this many hours are scored as recent */
const TRENDING_RECENT_HOURS = 1;
/** Baseline window: the hours beyond TRENDING_RECENT_HOURS used to measure ongoing coverage */
const TRENDING_BASELINE_HOURS = 5;
/** Characters used for per-country story dedup key within the trending window */
const DEDUP_TITLE_LENGTH = 40;

/** Check if any keyword is contained in the text */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Classify an article's severity and category */
export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (matchesAny(lower, HIGH_ECONOMIC))    return { severity: "high",   category: "economic"   };
  if (matchesAny(lower, HIGH_EXTREMISM))   return { severity: "high",   category: "extremism"  };
  if (matchesAny(lower, MEDIUM_EXTREMISM)) return { severity: "medium", category: "extremism"  };
  if (matchesAny(lower, HIGH_VIOLENT))     return { severity: "high",   category: "violent"    };
  if (matchesAny(lower, MEDIUM_VIOLENT))   return { severity: "medium", category: "violent"    };
  if (matchesAny(lower, LOW_MINOR))        return { severity: "low",    category: "minor"      };
  return null;
}

/** Detect a country ISO code from article text */
export function detectCountry(text: string): string | null {
  const lower = text.toLowerCase();
  for (const kw of SORTED_KEYWORDS) {
    if (lower.includes(kw)) {
      return KEYWORD_MAP.get(kw)!.code;
    }
  }
  return null;
}

function isWithinRetentionWindow(isoTime: string): boolean {
  const eventMs = new Date(isoTime).getTime();
  const cutoffMs = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;
  return eventMs >= cutoffMs;
}

function computeTrending(events: NewsEvent[]): Set<string> {
  const now = Date.now();
  const recentCutoff   = now - TRENDING_RECENT_HOURS   * 3_600_000;
  const baselineCutoff = now - (TRENDING_RECENT_HOURS + TRENDING_BASELINE_HOURS) * 3_600_000;

  const recentScores:   Record<string, number> = {};
  const baselineScores: Record<string, number> = {};
  const seenPerCountry = new Map<string, Set<string>>();

  for (const ev of events) {
    const evTime = new Date(ev.time).getTime();
    if (evTime < baselineCutoff) continue;

    const storyKey = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    let seen = seenPerCountry.get(ev.countryCode);
    if (!seen) { seen = new Set(); seenPerCountry.set(ev.countryCode, seen); }
    if (seen.has(storyKey)) continue;
    seen.add(storyKey);

    const weight = SEVERITY_WEIGHTS[ev.severity];
    if (evTime >= recentCutoff) {
      recentScores[ev.countryCode]   = (recentScores[ev.countryCode]   ?? 0) + weight;
    } else {
      baselineScores[ev.countryCode] = (baselineScores[ev.countryCode] ?? 0) + weight;
    }
  }

  // Velocity: sudden spike in coverage (new conflict) beats steady ongoing coverage.
  let topCode: string | null = null;
  let topVelocity = 0;
  for (const [code, recentScore] of Object.entries(recentScores)) {
    if (recentScore < TRENDING_THRESHOLD) continue;
    const baselineRate = (baselineScores[code] ?? 0) / TRENDING_BASELINE_HOURS;
    const velocity = recentScore / Math.max(baselineRate, 1);
    if (velocity > topVelocity) { topVelocity = velocity; topCode = code; }
  }

  return topCode ? new Set([topCode]) : new Set();
}

/** Aggregate events into per-country data */
export function aggregateCountries(events: NewsEvent[]): NewsMapData {
  const recent = events.filter((e) => isWithinRetentionWindow(e.time));
  const trending = computeTrending(recent);

  const byCode: Record<string, NewsEvent[]> = {};
  for (const ev of recent) {
    (byCode[ev.countryCode] ??= []).push(ev);
  }

  const countries: CountryNewsData[] = Object.entries(byCode).map(([code, evs]) => {
    const info = KEYWORD_MAP.get(code.toLowerCase());
    return {
      code,
      name: evs[0].country,
      lat: info?.lat ?? 0,
      lng: info?.lng ?? 0,
      trending: trending.has(code),
      events: evs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
    };
  });

  return { countries, lastUpdated: new Date().toISOString() };
}

/**
 * Generate mock data — used as a fallback when the API is unavailable
 * (e.g. local dev without the Vercel runtime).
 */
export function generateMockData(): NewsMapData {
  const now = new Date();
  const h = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

  const mockEvents: Omit<NewsEvent, "countryCode">[] = [
    { title: "Explosion near government building kills several", source: "Al Jazeera", time: h(1), country: "Iraq", severity: "high", category: "violent" },
    { title: "Airstrike targets militant positions in northern region", source: "BBC", time: h(2), country: "Syria", severity: "high", category: "violent" },
    { title: "Missile strike reported on port city", source: "Al Jazeera", time: h(1.5), country: "Yemen", severity: "high", category: "violent" },
    { title: "Casualties reported after drone strike", source: "BBC", time: h(3), country: "Ukraine", severity: "high", category: "violent" },
    { title: "Bombing attack on market leaves dozens dead", source: "Guardian", time: h(4), country: "Afghanistan", severity: "high", category: "violent" },
    { title: "Mass protests turn violent in capital", source: "DW", time: h(5), country: "Iran", severity: "high", category: "violent" },
    { title: "Stock market crash wipes billions off exchange", source: "BBC", time: h(2), country: "China", severity: "high", category: "economic" },
    { title: "Currency collapses amid economic meltdown", source: "Guardian", time: h(6), country: "Venezuela", severity: "high", category: "economic" },
    { title: "Banking crisis deepens as runs continue", source: "BBC", time: h(8), country: "Nigeria", severity: "high", category: "economic" },
    { title: "Trade embargo escalates trade war tensions", source: "Al Jazeera", time: h(3), country: "Russia", severity: "high", category: "economic" },
    { title: "Riot police clash with demonstrators downtown", source: "Guardian", time: h(7), country: "France", severity: "medium", category: "violent" },
    { title: "Armed confrontation near disputed border", source: "BBC", time: h(10), country: "India", severity: "medium", category: "violent" },
    { title: "Kidnapping of journalists reported in conflict zone", source: "Al Jazeera", time: h(12), country: "Libya", severity: "medium", category: "violent" },
    { title: "Thousands march in peaceful climate demonstration", source: "BBC", time: h(4), country: "Germany", severity: "low", category: "minor" },
    { title: "Civil unrest follows disputed election results", source: "Al Jazeera", time: h(11), country: "Ethiopia", severity: "low", category: "minor" },
    { title: "Evacuation ordered after minor earthquake", source: "DW", time: h(15), country: "Japan", severity: "low", category: "minor" },
    { title: "Food shortage worsens amid supply chain collapse", source: "Al Jazeera", time: h(6), country: "Sudan", severity: "high", category: "economic" },
    { title: "Mass casualties in coordinated terrorist attack", source: "BBC", time: h(2), country: "Somalia", severity: "high", category: "violent" },
    { title: "Tensions rise as military buildup continues", source: "DW", time: h(8), country: "North Korea", severity: "low", category: "minor" },
    { title: "Violent clashes erupt at border crossing", source: "Al Jazeera", time: h(16), country: "Myanmar", severity: "medium", category: "violent" },
    { title: "Neo-nazi march through city centre draws counter-protests", source: "Guardian", time: h(5), country: "Germany", severity: "medium", category: "extremism" },
    { title: "Antisemitic attack on synagogue injures worshippers", source: "BBC", time: h(3), country: "France", severity: "high", category: "extremism" },
    { title: "White supremacist rally triggers clashes with antifa groups", source: "Guardian", time: h(9), country: "United States", severity: "medium", category: "extremism" },
    { title: "Far-right extremist group banned after hate march", source: "BBC", time: h(14), country: "United Kingdom", severity: "medium", category: "extremism" },
  ];

  const eventWithCodes: NewsEvent[] = mockEvents.map((e) => {
    const info = UNIQUE_COUNTRIES.find((c) => c.name === e.country);
    return { ...e, countryCode: info?.code ?? "UN" };
  }).filter((e) => e.countryCode !== "UN");

  return { ...aggregateCountries(eventWithCodes), usingMockData: true };
}
