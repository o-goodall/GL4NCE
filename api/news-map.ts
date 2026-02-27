import type { IncomingMessage, ServerResponse } from "node:http";
import Parser from "rss-parser";

// ── Types (mirror src/components/news-map/types.ts) ─────────────────────────
type EventSeverity = "high" | "medium" | "low";
type EventCategory = "violent" | "minor" | "economic";

/** Number of characters used to build the deduplication key from a title.
 *  Long enough to distinguish different stories, short enough to catch
 *  the same article re-published with a minor suffix change. */
const DEDUP_TITLE_LENGTH = 60;

interface NewsEvent {
  title: string;
  source: string;
  time: string;
  country: string;
  countryCode: string;
  severity: EventSeverity;
  category: EventCategory;
  link?: string;
}

interface CountryNewsData {
  code: string;
  name: string;
  lat: number;
  lng: number;
  trending: boolean;
  events: NewsEvent[];
}

interface NewsMapData {
  countries: CountryNewsData[];
  lastUpdated: string;
  usingMockData?: boolean;
}

// ── Country database ─────────────────────────────────────────────────────────
interface CountryInfo {
  code: string;
  name: string;
  lat: number;
  lng: number;
  keywords: string[];
}

const COUNTRIES: CountryInfo[] = [
  { code: "US", name: "United States", lat: 37.09, lng: -95.71, keywords: ["united states", "america", "washington", "new york", "los angeles", "chicago", "texas", "california", "pentagon", "white house", "congress", "u.s."] },
  { code: "GB", name: "United Kingdom", lat: 55.38, lng: -3.44, keywords: ["united kingdom", "britain", "england", "london", "scotland", "wales", "birmingham", "manchester", "u.k."] },
  { code: "FR", name: "France", lat: 46.23, lng: 2.21, keywords: ["france", "french", "paris", "lyon", "marseille"] },
  { code: "DE", name: "Germany", lat: 51.17, lng: 10.45, keywords: ["germany", "german", "berlin", "munich", "hamburg", "frankfurt", "bundestag"] },
  { code: "RU", name: "Russia", lat: 61.52, lng: 105.32, keywords: ["russia", "russian", "moscow", "kremlin", "putin", "siberia", "st. petersburg"] },
  { code: "CN", name: "China", lat: 35.86, lng: 104.19, keywords: ["china", "chinese", "beijing", "shanghai", "xi jinping", "hong kong", "xinjiang", "tibet"] },
  { code: "JP", name: "Japan", lat: 36.20, lng: 138.25, keywords: ["japan", "japanese", "tokyo", "osaka", "kyoto", "hiroshima"] },
  { code: "IN", name: "India", lat: 20.59, lng: 78.96, keywords: ["india", "indian", "new delhi", "delhi", "mumbai", "bangalore", "kashmir", "modi"] },
  { code: "PK", name: "Pakistan", lat: 30.38, lng: 69.35, keywords: ["pakistan", "pakistani", "islamabad", "karachi", "lahore", "peshawar"] },
  { code: "AF", name: "Afghanistan", lat: 33.94, lng: 67.71, keywords: ["afghanistan", "afghan", "kabul", "kandahar", "taliban"] },
  { code: "IR", name: "Iran", lat: 32.43, lng: 53.69, keywords: ["iran", "iranian", "tehran", "isfahan", "khamenei", "irgc", "persian"] },
  { code: "IQ", name: "Iraq", lat: 33.22, lng: 43.68, keywords: ["iraq", "iraqi", "baghdad", "mosul", "basra", "erbil", "kirkuk"] },
  { code: "SY", name: "Syria", lat: 34.80, lng: 38.99, keywords: ["syria", "syrian", "damascus", "aleppo", "homs", "idlib"] },
  { code: "IL", name: "Israel", lat: 31.05, lng: 34.85, keywords: ["israel", "israeli", "jerusalem", "tel aviv", "netanyahu", "idf"] },
  { code: "PS", name: "Palestine", lat: 31.95, lng: 35.23, keywords: ["palestine", "palestinian", "gaza", "ramallah", "hamas", "west bank"] },
  { code: "SA", name: "Saudi Arabia", lat: 23.89, lng: 45.08, keywords: ["saudi arabia", "saudi", "riyadh", "jeddah", "mecca", "mbs"] },
  { code: "AE", name: "UAE", lat: 23.42, lng: 53.85, keywords: ["united arab emirates", "dubai", "abu dhabi"] },
  { code: "YE", name: "Yemen", lat: 15.55, lng: 48.52, keywords: ["yemen", "yemeni", "sanaa", "aden", "houthi"] },
  { code: "LB", name: "Lebanon", lat: 33.85, lng: 35.86, keywords: ["lebanon", "lebanese", "beirut", "hezbollah"] },
  { code: "TR", name: "Turkey", lat: 38.96, lng: 35.24, keywords: ["turkey", "turkish", "ankara", "istanbul", "erdogan"] },
  { code: "UA", name: "Ukraine", lat: 48.38, lng: 31.17, keywords: ["ukraine", "ukrainian", "kyiv", "kharkiv", "odessa", "mariupol", "zelensky", "donbas"] },
  { code: "BY", name: "Belarus", lat: 53.71, lng: 27.95, keywords: ["belarus", "belarusian", "minsk", "lukashenko"] },
  { code: "PL", name: "Poland", lat: 51.92, lng: 19.15, keywords: ["poland", "polish", "warsaw", "krakow"] },
  { code: "BR", name: "Brazil", lat: -14.24, lng: -51.93, keywords: ["brazil", "brazilian", "brasilia", "são paulo", "sao paulo", "rio de janeiro", "amazon", "lula"] },
  { code: "MX", name: "Mexico", lat: 23.63, lng: -102.55, keywords: ["mexico", "mexican", "mexico city", "guadalajara", "monterrey", "cartel"] },
  { code: "CO", name: "Colombia", lat: 4.57, lng: -74.30, keywords: ["colombia", "colombian", "bogota", "medellin", "farc"] },
  { code: "VE", name: "Venezuela", lat: 6.42, lng: -66.59, keywords: ["venezuela", "venezuelan", "caracas", "maduro"] },
  { code: "AR", name: "Argentina", lat: -38.42, lng: -63.62, keywords: ["argentina", "argentine", "buenos aires", "milei"] },
  { code: "NG", name: "Nigeria", lat: 9.08, lng: 8.68, keywords: ["nigeria", "nigerian", "abuja", "lagos", "kano", "boko haram"] },
  { code: "ZA", name: "South Africa", lat: -30.56, lng: 22.94, keywords: ["south africa", "south african", "johannesburg", "cape town", "pretoria"] },
  { code: "ET", name: "Ethiopia", lat: 9.15, lng: 40.49, keywords: ["ethiopia", "ethiopian", "addis ababa", "tigray"] },
  { code: "SD", name: "Sudan", lat: 12.86, lng: 30.22, keywords: ["sudan", "sudanese", "khartoum", "darfur", "rsf"] },
  { code: "LY", name: "Libya", lat: 26.34, lng: 17.23, keywords: ["libya", "libyan", "tripoli", "benghazi"] },
  { code: "ML", name: "Mali", lat: 17.57, lng: -3.99, keywords: ["mali", "malian", "bamako"] },
  { code: "SO", name: "Somalia", lat: 5.15, lng: 46.20, keywords: ["somalia", "somali", "mogadishu", "al-shabaab", "al shabaab"] },
  { code: "SS", name: "South Sudan", lat: 6.88, lng: 31.31, keywords: ["south sudan", "juba"] },
  { code: "CD", name: "DR Congo", lat: -4.04, lng: 21.76, keywords: ["congo", "congolese", "kinshasa", "drc", "m23"] },
  { code: "KP", name: "North Korea", lat: 40.34, lng: 127.51, keywords: ["north korea", "north korean", "pyongyang", "kim jong", "dprk"] },
  { code: "KR", name: "South Korea", lat: 35.91, lng: 127.77, keywords: ["south korea", "south korean", "seoul", "busan"] },
  { code: "TW", name: "Taiwan", lat: 23.70, lng: 120.96, keywords: ["taiwan", "taiwanese", "taipei"] },
  { code: "MM", name: "Myanmar", lat: 21.91, lng: 95.96, keywords: ["myanmar", "burmese", "naypyidaw", "yangon", "rangoon", "junta"] },
  { code: "EG", name: "Egypt", lat: 26.82, lng: 30.80, keywords: ["egypt", "egyptian", "cairo", "sinai", "sisi"] },
  { code: "MA", name: "Morocco", lat: 31.79, lng: -7.09, keywords: ["morocco", "moroccan", "rabat", "casablanca"] },
  { code: "GH", name: "Ghana", lat: 7.95, lng: -1.02, keywords: ["ghana", "ghanaian", "accra"] },
  { code: "KE", name: "Kenya", lat: -0.02, lng: 37.91, keywords: ["kenya", "kenyan", "nairobi"] },
  { code: "IT", name: "Italy", lat: 41.87, lng: 12.57, keywords: ["italy", "italian", "rome", "milan", "naples"] },
  { code: "ES", name: "Spain", lat: 40.46, lng: -3.75, keywords: ["spain", "spanish", "madrid", "barcelona", "catalonia"] },
  { code: "GR", name: "Greece", lat: 39.07, lng: 21.82, keywords: ["greece", "greek", "athens"] },
  { code: "HU", name: "Hungary", lat: 47.16, lng: 19.50, keywords: ["hungary", "hungarian", "budapest", "orban"] },
  { code: "CA", name: "Canada", lat: 56.13, lng: -106.35, keywords: ["canada", "canadian", "ottawa", "toronto", "trudeau"] },
  { code: "AU", name: "Australia", lat: -25.27, lng: 133.78, keywords: ["australia", "australian", "canberra", "sydney", "melbourne"] },
  { code: "NL", name: "Netherlands", lat: 52.13, lng: 5.29, keywords: ["netherlands", "dutch", "amsterdam", "the hague"] },
  { code: "BE", name: "Belgium", lat: 50.50, lng: 4.47, keywords: ["belgium", "belgian", "brussels", "nato"] },
  { code: "CH", name: "Switzerland", lat: 46.82, lng: 8.23, keywords: ["switzerland", "swiss", "geneva", "zurich", "davos"] },
  { code: "RS", name: "Serbia", lat: 44.02, lng: 21.01, keywords: ["serbia", "serbian", "belgrade", "kosovo"] },
  { code: "FI", name: "Finland", lat: 61.92, lng: 25.75, keywords: ["finland", "finnish", "helsinki"] },
  { code: "SE", name: "Sweden", lat: 60.13, lng: 18.64, keywords: ["sweden", "swedish", "stockholm"] },
  { code: "NO", name: "Norway", lat: 60.47, lng: 8.47, keywords: ["norway", "norwegian", "oslo"] },
];

// Build keyword → country lookup (longest-match wins in detectCountry)
const KEYWORD_MAP = new Map<string, CountryInfo>();
for (const c of COUNTRIES) {
  KEYWORD_MAP.set(c.code.toLowerCase(), c);
  KEYWORD_MAP.set(c.name.toLowerCase(), c);
  for (const kw of c.keywords) {
    if (!KEYWORD_MAP.has(kw)) KEYWORD_MAP.set(kw, c);
  }
}

// Sorted keywords longest-first for greedy matching
const SORTED_KEYWORDS = [...KEYWORD_MAP.keys()].sort((a, b) => b.length - a.length);

// ── RSS sources ──────────────────────────────────────────────────────────────
// Uses the same reliable international feeds as situation-monitor.
// Al Jazeera conflict feed is the primary source; others supplement coverage.
const RSS_SOURCES = [
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/subjects/conflict.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "BBC",        url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Guardian",   url: "https://www.theguardian.com/world/rss" },
  { name: "DW",         url: "https://rss.dw.com/xml/rss-en-world" },
];

const ARTICLES_PER_FEED = 15;

// ── Classification keyword lists ─────────────────────────────────────────────
const HIGH_VIOLENT = ["bombing", "explosion", "suicide attack", "terrorist attack", "killed", "death toll", "casualties", "massacre", "murder", "airstrike", "air strike", "missile strike", "drone strike"];
const MEDIUM_VIOLENT = ["shooting", "stabbing", "assault", "riot", "clashes", "street fighting", "armed confrontation", "hostage", "abduction", "kidnapping"];
const LOW_MINOR = ["peaceful protest", "demonstration", "march", "worker strike", "civil unrest", "blockade", "curfew", "evacuation", "flooding", "earthquake", "storm", "tension", "dispute"];
const HIGH_ECONOMIC = ["stock market crash", "market collapse", "hyperinflation", "currency collapse", "devaluation", "economic meltdown", "debt default", "sovereign default", "banking crisis", "bank run", "financial crisis", "severe sanctions", "trade embargo", "trade war", "food shortage", "energy crisis"];

const TRENDING_THRESHOLD = 3;
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 };
const RETENTION_HOURS = 48;
/** Events within this window contribute to the trending score */
const TRENDING_WINDOW_HOURS = 2;

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (matchesAny(lower, HIGH_ECONOMIC))  return { severity: "high",   category: "economic" };
  if (matchesAny(lower, HIGH_VIOLENT))   return { severity: "high",   category: "violent"  };
  if (matchesAny(lower, MEDIUM_VIOLENT)) return { severity: "medium", category: "violent"  };
  if (matchesAny(lower, LOW_MINOR))      return { severity: "low",    category: "minor"    };
  return null;
}

function detectCountry(text: string): CountryInfo | null {
  const lower = text.toLowerCase();
  for (const kw of SORTED_KEYWORDS) {
    if (lower.includes(kw)) return KEYWORD_MAP.get(kw)!;
  }
  return null;
}

function isWithinRetentionWindow(isoTime: string): boolean {
  return Date.now() - new Date(isoTime).getTime() <= RETENTION_HOURS * 3_600_000;
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

function aggregateCountries(events: NewsEvent[]): CountryNewsData[] {
  const recent = events.filter((e) => isWithinRetentionWindow(e.time));
  const trending = computeTrending(recent);
  const byCode: Record<string, NewsEvent[]> = {};
  for (const ev of recent) (byCode[ev.countryCode] ??= []).push(ev);
  return Object.entries(byCode).map(([code, evs]) => {
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
}

// ── Mock data — shown when all RSS feeds are unavailable ─────────────────────
function generateMockData(): NewsMapData {
  const now = new Date();
  const h = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const raw: Array<Omit<NewsEvent, "countryCode"> & { countryName: string }> = [
    { title: "Explosion near government building kills several", source: "Al Jazeera", time: h(1),  country: "Iraq",         countryName: "Iraq",         severity: "high",   category: "violent"  },
    { title: "Airstrike targets militant positions in northern region",  source: "BBC",        time: h(2),  country: "Syria",        countryName: "Syria",        severity: "high",   category: "violent"  },
    { title: "Missile strike reported on port city",                     source: "Al Jazeera", time: h(1.5),country: "Yemen",        countryName: "Yemen",        severity: "high",   category: "violent"  },
    { title: "Casualties reported after drone strike",                   source: "BBC",        time: h(3),  country: "Ukraine",      countryName: "Ukraine",      severity: "high",   category: "violent"  },
    { title: "Bombing attack on market leaves dozens dead",              source: "Guardian",   time: h(4),  country: "Afghanistan",  countryName: "Afghanistan",  severity: "high",   category: "violent"  },
    { title: "Mass protests turn violent in capital",                    source: "DW",         time: h(5),  country: "Iran",         countryName: "Iran",         severity: "high",   category: "violent"  },
    { title: "Stock market crash wipes billions off exchange",           source: "BBC",        time: h(2),  country: "China",        countryName: "China",        severity: "high",   category: "economic" },
    { title: "Currency collapses amid economic meltdown",               source: "Guardian",   time: h(6),  country: "Venezuela",    countryName: "Venezuela",    severity: "high",   category: "economic" },
    { title: "Banking crisis deepens as runs continue",                  source: "BBC",        time: h(8),  country: "Nigeria",      countryName: "Nigeria",      severity: "high",   category: "economic" },
    { title: "Trade embargo escalates trade war tensions",               source: "Al Jazeera", time: h(3),  country: "Russia",       countryName: "Russia",       severity: "high",   category: "economic" },
    { title: "Riot police clash with demonstrators downtown",            source: "Guardian",   time: h(7),  country: "France",       countryName: "France",       severity: "medium", category: "violent"  },
    { title: "Armed confrontation near disputed border",                 source: "BBC",        time: h(10), country: "India",        countryName: "India",        severity: "medium", category: "violent"  },
    { title: "Kidnapping of journalists reported in conflict zone",      source: "Al Jazeera", time: h(12), country: "Libya",        countryName: "Libya",        severity: "medium", category: "violent"  },
    { title: "Thousands march in peaceful climate demonstration",        source: "BBC",        time: h(4),  country: "Germany",      countryName: "Germany",      severity: "low",    category: "minor"    },
    { title: "Civil unrest follows disputed election results",           source: "Al Jazeera", time: h(11), country: "Ethiopia",     countryName: "Ethiopia",     severity: "low",    category: "minor"    },
    { title: "Evacuation ordered after minor earthquake",               source: "DW",         time: h(15), country: "Japan",        countryName: "Japan",        severity: "low",    category: "minor"    },
    { title: "Food shortage worsens amid supply chain collapse",         source: "Al Jazeera", time: h(6),  country: "Sudan",        countryName: "Sudan",        severity: "high",   category: "economic" },
    { title: "Mass casualties in coordinated terrorist attack",          source: "BBC",        time: h(2),  country: "Somalia",      countryName: "Somalia",      severity: "high",   category: "violent"  },
    { title: "Tensions rise as military buildup continues",              source: "DW",         time: h(8),  country: "North Korea",  countryName: "North Korea",  severity: "low",    category: "minor"    },
    { title: "Violent clashes erupt at border crossing",                source: "Al Jazeera", time: h(16), country: "Myanmar",      countryName: "Myanmar",      severity: "medium", category: "violent"  },
  ];
  const events: NewsEvent[] = raw
    .map((e) => {
      const info = KEYWORD_MAP.get(e.countryName.toLowerCase());
      return info ? { title: e.title, source: e.source, time: e.time, country: e.country, countryCode: info.code, severity: e.severity, category: e.category } : null;
    })
    .filter((e): e is NewsEvent => e !== null);
  return { countries: aggregateCountries(events), lastUpdated: new Date().toISOString(), usingMockData: true };
}

// ── Module-level response cache (5-minute TTL) ───────────────────────────────
let _cache: NewsMapData | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const parser = new Parser({
  requestOptions: {
    headers: {
      "User-Agent": "GL4NCE-NewsMap/1.0 (https://github.com/o-goodall/GL4NCE)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  },
});

async function fetchAllEvents(): Promise<NewsEvent[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (src) => {
      const feed = await parser.parseURL(src.url);
      const events: NewsEvent[] = [];
      for (const item of (feed.items ?? []).slice(0, ARTICLES_PER_FEED)) {
        if (!item.title || !item.link) continue;
        const text = `${item.title} ${item.contentSnippet ?? item.content ?? ""}`;
        const cls = classifyEvent(text);
        if (!cls) continue;
        const country = detectCountry(text);
        if (!country) continue;
        events.push({
          title: item.title,
          source: src.name,
          time: item.pubDate ?? new Date().toISOString(),
          country: country.name,
          countryCode: country.code,
          severity: cls.severity,
          category: cls.category,
          link: item.link,
        });
      }
      return events;
    })
  );
  // Deduplicate by title (same story from multiple feeds)
  const seen = new Set<string>();
  const all: NewsEvent[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const ev of r.value) {
      const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
      if (!seen.has(key)) { seen.add(key); all.push(ev); }
    }
  }
  return all;
}

// ── Vercel serverless handler ────────────────────────────────────────────────
export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Serve cached result if still fresh
  if (_cache && Date.now() < _cacheExpiresAt) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.end(JSON.stringify(_cache));
    return;
  }

  try {
    const events = await fetchAllEvents();
    const data: NewsMapData =
      events.length > 0
        ? { countries: aggregateCountries(events), lastUpdated: new Date().toISOString() }
        : generateMockData();

    _cache = data;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.end(JSON.stringify(data));
  } catch {
    // On unexpected error return mock data so the map is never blank
    const fallback = generateMockData();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60");
    res.end(JSON.stringify(fallback));
  }
}
