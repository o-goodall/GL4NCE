import type { NewsEvent, EventSeverity, EventCategory, CountryNewsData, NewsMapData } from "./types";
import { KEYWORD_MAP, UNIQUE_COUNTRIES } from "./countryData";

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

const TRENDING_THRESHOLD = 3;
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 };
const RETENTION_HOURS = 48;
/** Events within this window contribute to the trending score */
const TRENDING_WINDOW_HOURS = 2;

/** Check if any keyword is contained in the text */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Classify an article's severity and category */
export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (matchesAny(lower, HIGH_ECONOMIC)) return { severity: "high", category: "economic" };
  if (matchesAny(lower, HIGH_VIOLENT)) return { severity: "high", category: "violent" };
  if (matchesAny(lower, MEDIUM_VIOLENT)) return { severity: "medium", category: "violent" };
  if (matchesAny(lower, LOW_MINOR)) return { severity: "low", category: "minor" };
  return null;
}

/** Detect a country ISO code from article text */
export function detectCountry(text: string): string | null {
  const lower = text.toLowerCase();

  // Try longest keyword match first by iterating sorted by length desc
  const sortedKeys = [...KEYWORD_MAP.keys()].sort((a, b) => b.length - a.length);
  for (const kw of sortedKeys) {
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
  const scores: Record<string, number> = {};
  const cutoff = Date.now() - TRENDING_WINDOW_HOURS * 3_600_000;
  for (const ev of events) {
    if (new Date(ev.time).getTime() < cutoff) continue;
    scores[ev.countryCode] = (scores[ev.countryCode] ?? 0) + SEVERITY_WEIGHTS[ev.severity];
  }
  return new Set(Object.keys(scores).filter((code) => scores[code] >= TRENDING_THRESHOLD));
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
  ];

  const eventWithCodes: NewsEvent[] = mockEvents.map((e) => {
    const info = UNIQUE_COUNTRIES.find((c) => c.name === e.country);
    return { ...e, countryCode: info?.code ?? "UN" };
  }).filter((e) => e.countryCode !== "UN");

  return { ...aggregateCountries(eventWithCodes), usingMockData: true };
}
