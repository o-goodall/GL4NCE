import type { IncomingMessage, ServerResponse } from "node:http";
import Parser from "rss-parser";

// ── Types (mirror src/components/news-map/types.ts) ─────────────────────────
type EventSeverity = "high" | "medium" | "low";
type EventCategory = "violent" | "minor" | "economic" | "extremism";

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
  /** Feed health — how many sources responded successfully out of total attempted */
  feedStats?: { succeeded: number; total: number };
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
  { code: "US", name: "United States", lat: 37.09, lng: -95.71, keywords: ["united states", "america", "washington", "new york", "los angeles", "chicago", "texas", "california", "pentagon", "white house", "congress", "u.s.", "us "] },
  { code: "GB", name: "United Kingdom", lat: 55.38, lng: -3.44, keywords: ["united kingdom", "britain", "england", "london", "scotland", "wales", "birmingham", "manchester", "u.k.", "uk "] },
  { code: "FR", name: "France", lat: 46.23, lng: 2.21, keywords: ["france", "french", "paris", "lyon", "marseille", "élysée"] },
  { code: "DE", name: "Germany", lat: 51.17, lng: 10.45, keywords: ["germany", "german", "berlin", "munich", "hamburg", "frankfurt", "bundestag"] },
  { code: "RU", name: "Russia", lat: 61.52, lng: 105.32, keywords: ["russia", "russian", "moscow", "kremlin", "putin", "siberia", "st. petersburg", "saint petersburg"] },
  { code: "CN", name: "China", lat: 35.86, lng: 104.19, keywords: ["china", "chinese", "beijing", "shanghai", "xi jinping", "hong kong", "taiwan strait", "xinjiang", "tibet"] },
  { code: "JP", name: "Japan", lat: 36.20, lng: 138.25, keywords: ["japan", "japanese", "tokyo", "osaka", "kyoto", "hiroshima", "nagasaki"] },
  { code: "IN", name: "India", lat: 20.59, lng: 78.96, keywords: ["india", "indian", "new delhi", "delhi", "mumbai", "bangalore", "kashmir", "modi"] },
  { code: "PK", name: "Pakistan", lat: 30.38, lng: 69.35, keywords: ["pakistan", "pakistani", "islamabad", "karachi", "lahore", "peshawar"] },
  { code: "AF", name: "Afghanistan", lat: 33.94, lng: 67.71, keywords: ["afghanistan", "afghan", "kabul", "kandahar", "taliban"] },
  { code: "IR", name: "Iran", lat: 32.43, lng: 53.69, keywords: ["iran", "iranian", "tehran", "isfahan", "khamenei", "rouhani", "irgc", "persian"] },
  { code: "IQ", name: "Iraq", lat: 33.22, lng: 43.68, keywords: ["iraq", "iraqi", "baghdad", "mosul", "basra", "erbil", "kirkuk"] },
  { code: "SY", name: "Syria", lat: 34.80, lng: 38.99, keywords: ["syria", "syrian", "damascus", "aleppo", "homs", "idlib", "isis", "isil"] },
  { code: "IL", name: "Israel", lat: 31.05, lng: 34.85, keywords: ["israel", "israeli", "jerusalem", "tel aviv", "netanyahu", "idf", "west bank", "gaza"] },
  { code: "PS", name: "Palestine", lat: 31.95, lng: 35.23, keywords: ["palestine", "palestinian", "gaza", "ramallah", "hamas", "west bank"] },
  { code: "SA", name: "Saudi Arabia", lat: 23.89, lng: 45.08, keywords: ["saudi arabia", "saudi", "riyadh", "jeddah", "mecca", "medina", "mbs"] },
  { code: "AE", name: "UAE", lat: 23.42, lng: 53.85, keywords: ["uae", "united arab emirates", "dubai", "abu dhabi"] },
  { code: "YE", name: "Yemen", lat: 15.55, lng: 48.52, keywords: ["yemen", "yemeni", "sanaa", "aden", "houthi"] },
  { code: "LB", name: "Lebanon", lat: 33.85, lng: 35.86, keywords: ["lebanon", "lebanese", "beirut", "hezbollah"] },
  { code: "TR", name: "Turkey", lat: 38.96, lng: 35.24, keywords: ["turkey", "turkish", "ankara", "istanbul", "erdogan"] },
  { code: "UA", name: "Ukraine", lat: 48.38, lng: 31.17, keywords: ["ukraine", "ukrainian", "kyiv", "kharkiv", "odessa", "mariupol", "zelensky", "donbas", "zaporizhzhia"] },
  { code: "BY", name: "Belarus", lat: 53.71, lng: 27.95, keywords: ["belarus", "belarusian", "minsk", "lukashenko"] },
  { code: "PL", name: "Poland", lat: 51.92, lng: 19.15, keywords: ["poland", "polish", "warsaw", "krakow"] },
  { code: "BR", name: "Brazil", lat: -14.24, lng: -51.93, keywords: ["brazil", "brazilian", "brasilia", "são paulo", "sao paulo", "rio de janeiro", "amazon", "lula"] },
  { code: "MX", name: "Mexico", lat: 23.63, lng: -102.55, keywords: ["mexico", "mexican", "mexico city", "guadalajara", "monterrey", "cartel", "pemex"] },
  { code: "CO", name: "Colombia", lat: 4.57, lng: -74.30, keywords: ["colombia", "colombian", "bogota", "medellin", "farc"] },
  { code: "VE", name: "Venezuela", lat: 6.42, lng: -66.59, keywords: ["venezuela", "venezuelan", "caracas", "maduro"] },
  { code: "AR", name: "Argentina", lat: -38.42, lng: -63.62, keywords: ["argentina", "argentine", "buenos aires", "milei"] },
  { code: "CL", name: "Chile", lat: -35.68, lng: -71.54, keywords: ["chile", "chilean", "santiago"] },
  { code: "NG", name: "Nigeria", lat: 9.08, lng: 8.68, keywords: ["nigeria", "nigerian", "abuja", "lagos", "kano", "boko haram"] },
  { code: "ZA", name: "South Africa", lat: -30.56, lng: 22.94, keywords: ["south africa", "south african", "johannesburg", "cape town", "pretoria", "anc"] },
  { code: "ET", name: "Ethiopia", lat: 9.15, lng: 40.49, keywords: ["ethiopia", "ethiopian", "addis ababa", "tigray"] },
  { code: "SD", name: "Sudan", lat: 12.86, lng: 30.22, keywords: ["sudan", "sudanese", "khartoum", "darfur", "rsf"] },
  { code: "LY", name: "Libya", lat: 26.34, lng: 17.23, keywords: ["libya", "libyan", "tripoli", "benghazi"] },
  { code: "ML", name: "Mali", lat: 17.57, lng: -3.99, keywords: ["mali", "malian", "bamako"] },
  { code: "SO", name: "Somalia", lat: 5.15, lng: 46.20, keywords: ["somalia", "somali", "mogadishu", "al-shabaab", "al shabaab"] },
  { code: "SS", name: "South Sudan", lat: 6.88, lng: 31.31, keywords: ["south sudan", "south sudanese", "juba"] },
  { code: "CD", name: "DR Congo", lat: -4.04, lng: 21.76, keywords: ["congo", "congolese", "kinshasa", "drc", "m23"] },
  { code: "KP", name: "North Korea", lat: 40.34, lng: 127.51, keywords: ["north korea", "north korean", "pyongyang", "kim jong-un", "kim jong un", "dprk"] },
  { code: "KR", name: "South Korea", lat: 35.91, lng: 127.77, keywords: ["south korea", "south korean", "seoul", "busan"] },
  { code: "TW", name: "Taiwan", lat: 23.70, lng: 120.96, keywords: ["taiwan", "taiwanese", "taipei"] },
  { code: "MM", name: "Myanmar", lat: 21.91, lng: 95.96, keywords: ["myanmar", "burmese", "naypyidaw", "yangon", "rangoon", "junta"] },
  { code: "TH", name: "Thailand", lat: 15.87, lng: 100.99, keywords: ["thailand", "thai", "bangkok"] },
  { code: "PH", name: "Philippines", lat: 12.88, lng: 121.77, keywords: ["philippines", "philippine", "manila", "mindanao", "duterte", "marcos"] },
  { code: "ID", name: "Indonesia", lat: -0.79, lng: 113.92, keywords: ["indonesia", "indonesian", "jakarta"] },
  { code: "EG", name: "Egypt", lat: 26.82, lng: 30.80, keywords: ["egypt", "egyptian", "cairo", "sinai", "sisi"] },
  { code: "MA", name: "Morocco", lat: 31.79, lng: -7.09, keywords: ["morocco", "moroccan", "rabat", "casablanca"] },
  { code: "DZ", name: "Algeria", lat: 28.03, lng: 1.66, keywords: ["algeria", "algerian", "algiers"] },
  { code: "TN", name: "Tunisia", lat: 33.89, lng: 9.54, keywords: ["tunisia", "tunisian", "tunis"] },
  { code: "GH", name: "Ghana", lat: 7.95, lng: -1.02, keywords: ["ghana", "ghanaian", "accra"] },
  { code: "KE", name: "Kenya", lat: -0.02, lng: 37.91, keywords: ["kenya", "kenyan", "nairobi"] },
  { code: "UZ", name: "Uzbekistan", lat: 41.38, lng: 64.58, keywords: ["uzbekistan", "uzbek", "tashkent"] },
  { code: "KZ", name: "Kazakhstan", lat: 48.02, lng: 66.92, keywords: ["kazakhstan", "kazakh", "astana", "almaty"] },
  { code: "IT", name: "Italy", lat: 41.87, lng: 12.57, keywords: ["italy", "italian", "rome", "milan", "naples"] },
  { code: "ES", name: "Spain", lat: 40.46, lng: -3.75, keywords: ["spain", "spanish", "madrid", "barcelona", "catalonia"] },
  { code: "GR", name: "Greece", lat: 39.07, lng: 21.82, keywords: ["greece", "greek", "athens"] },
  { code: "HU", name: "Hungary", lat: 47.16, lng: 19.50, keywords: ["hungary", "hungarian", "budapest", "orban"] },
  { code: "SE", name: "Sweden", lat: 60.13, lng: 18.64, keywords: ["sweden", "swedish", "stockholm"] },
  { code: "NO", name: "Norway", lat: 60.47, lng: 8.47, keywords: ["norway", "norwegian", "oslo"] },
  { code: "CA", name: "Canada", lat: 56.13, lng: -106.35, keywords: ["canada", "canadian", "ottawa", "toronto", "trudeau"] },
  { code: "AU", name: "Australia", lat: -25.27, lng: 133.78, keywords: ["australia", "australian", "canberra", "sydney", "melbourne"] },
  { code: "NZ", name: "New Zealand", lat: -40.90, lng: 174.89, keywords: ["new zealand", "kiwi", "wellington", "auckland"] },
  { code: "PT", name: "Portugal", lat: 39.40, lng: -8.22, keywords: ["portugal", "portuguese", "lisbon"] },
  { code: "NL", name: "Netherlands", lat: 52.13, lng: 5.29, keywords: ["netherlands", "dutch", "amsterdam", "the hague", "hague"] },
  { code: "BE", name: "Belgium", lat: 50.50, lng: 4.47, keywords: ["belgium", "belgian", "brussels", "nato hq"] },
  { code: "CH", name: "Switzerland", lat: 46.82, lng: 8.23, keywords: ["switzerland", "swiss", "geneva", "zurich", "davos"] },
  { code: "AT", name: "Austria", lat: 47.52, lng: 14.55, keywords: ["austria", "austrian", "vienna"] },
  { code: "CZ", name: "Czech Republic", lat: 49.82, lng: 15.47, keywords: ["czech", "prague"] },
  { code: "RO", name: "Romania", lat: 45.94, lng: 24.97, keywords: ["romania", "romanian", "bucharest"] },
  { code: "BG", name: "Bulgaria", lat: 42.73, lng: 25.49, keywords: ["bulgaria", "bulgarian", "sofia"] },
  { code: "RS", name: "Serbia", lat: 44.02, lng: 21.01, keywords: ["serbia", "serbian", "belgrade", "kosovo"] },
  { code: "HR", name: "Croatia", lat: 45.10, lng: 15.20, keywords: ["croatia", "croatian", "zagreb"] },
  { code: "SK", name: "Slovakia", lat: 48.67, lng: 19.70, keywords: ["slovakia", "slovak", "bratislava"] },
  { code: "FI", name: "Finland", lat: 61.92, lng: 25.75, keywords: ["finland", "finnish", "helsinki"] },
  { code: "DK", name: "Denmark", lat: 56.26, lng: 9.50, keywords: ["denmark", "danish", "copenhagen"] },
  { code: "IE", name: "Ireland", lat: 53.41, lng: -8.24, keywords: ["ireland", "irish", "dublin"] },
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
// All feeds are fetched concurrently via Promise.allSettled — a single slow or
// unavailable feed fails fast (10 s timeout) without blocking the others.
//
// Excluded from this list:
//   Reuters       – removed public RSS in 2020; feeds.reuters.com always 404s
//   FT            – full paywall; RSS returns no usable article text
//   Telesur       – Venezuelan state outlet; RSS endpoint unreliable
//   Euronews/FBN  – Feedburner variant deprecated; direct feed already present
const RSS_SOURCES = [
  // ── Primary / High-volume world news ───────────────────────────────────────
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/subjects/conflict.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "BBC",        url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "AP News",    url: "https://feeds.apnews.com/apnews/world" },
  { name: "CNN",        url: "https://rss.cnn.com/rss/edition_world.rss" },
  { name: "Guardian",   url: "https://www.theguardian.com/world/rss" },
  // ── Regional coverage ──────────────────────────────────────────────────────
  { name: "DW",         url: "https://rss.dw.com/xml/rss-en-world" },
  { name: "France24",   url: "https://www.france24.com/en/rss" },
  { name: "Sky News",   url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { name: "RFE/RL",     url: "https://www.rferl.org/api/jqpxiflpqo" },
  { name: "Euronews",   url: "https://www.euronews.com/rss?format=mrss&level=theme&name=news" },
  { name: "CNA",        url: "https://www.channelnewsasia.com/rssfeeds/8395884" },
  { name: "Africanews", url: "https://www.africanews.com/feed/" },
  // ── Specialist / humanitarian ──────────────────────────────────────────────
  { name: "ReliefWeb",  url: "https://reliefweb.int/updates/rss.xml" },
  { name: "UN News",    url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml" },
];

const ARTICLES_PER_FEED = 20;

// ── Classification keyword lists ─────────────────────────────────────────────
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
  // Humanitarian / disaster terms — surfaces ReliefWeb and UN News articles
  "refugee", "refugees", "displaced", "displacement",
  "humanitarian", "famine", "drought",
  "disease outbreak", "epidemic", "aid convoy",
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
/** Events within this window contribute to the trending score */
const TRENDING_WINDOW_HOURS = 2;

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (matchesAny(lower, HIGH_ECONOMIC))    return { severity: "high",   category: "economic"   };
  if (matchesAny(lower, HIGH_EXTREMISM))   return { severity: "high",   category: "extremism"  };
  if (matchesAny(lower, MEDIUM_EXTREMISM)) return { severity: "medium", category: "extremism"  };
  if (matchesAny(lower, HIGH_VIOLENT))     return { severity: "high",   category: "violent"    };
  if (matchesAny(lower, MEDIUM_VIOLENT))   return { severity: "medium", category: "violent"    };
  if (matchesAny(lower, LOW_MINOR))        return { severity: "low",    category: "minor"      };
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
    { title: "Tensions rise as military buildup continues",              source: "DW",         time: h(8),  country: "North Korea",  countryName: "North Korea",  severity: "low",    category: "minor"      },
    { title: "Violent clashes erupt at border crossing",                source: "Al Jazeera", time: h(16), country: "Myanmar",      countryName: "Myanmar",      severity: "medium", category: "violent"    },
    { title: "Neo-nazi march through city centre draws counter-protests", source: "Guardian",  time: h(5),  country: "Germany",      countryName: "Germany",      severity: "medium", category: "extremism"  },
    { title: "Antisemitic attack on synagogue injures worshippers",      source: "BBC",        time: h(3),  country: "France",       countryName: "France",       severity: "high",   category: "extremism"  },
    { title: "White supremacist rally triggers clashes with antifa",     source: "Guardian",   time: h(9),  country: "United States", countryName: "United States",  severity: "medium", category: "extremism"  },
    { title: "Far-right extremist group banned after hate march",        source: "BBC",        time: h(14), country: "United Kingdom", countryName: "United Kingdom", severity: "medium", category: "extremism"  },
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
  // Reduce per-feed timeout from the 60-second default to 10 seconds.
  // With Promise.allSettled, a slow/blocked feed (e.g. Al Jazeera anti-bot)
  // previously stalled the entire response for a full minute.
  timeout: 10_000,
  // Fall back to RSS 2.0 parsing for feeds that omit the version attribute.
  defaultRSS: 2.0,
  headers: {
    // A descriptive but browser-compatible User-Agent reduces bot-detection
    // blocks from sites like Al Jazeera that filter automated UA strings.
    "User-Agent": "Mozilla/5.0 (compatible; GL4NCE-NewsMap/1.0; +https://github.com/o-goodall/GL4NCE)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
});

async function fetchAllEvents(): Promise<{ events: NewsEvent[]; feedStats: { succeeded: number; total: number } }> {
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
        // isoDate is normalised by rss-parser; pubDate can be in any locale format
        const rawTime = item.isoDate ?? item.pubDate;
        const parsedDate = rawTime ? new Date(rawTime) : null;
        const time = parsedDate && !isNaN(parsedDate.getTime())
          ? parsedDate.toISOString()
          : new Date().toISOString();
        events.push({
          title: item.title,
          source: src.name,
          time,
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
  let succeeded = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    succeeded++;
    for (const ev of r.value) {
      const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
      if (!seen.has(key)) { seen.add(key); all.push(ev); }
    }
  }
  return { events: all, feedStats: { succeeded, total: RSS_SOURCES.length } };
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
    const { events, feedStats } = await fetchAllEvents();
    const data: NewsMapData =
      events.length > 0
        ? { countries: aggregateCountries(events), lastUpdated: new Date().toISOString(), feedStats }
        : { ...generateMockData(), feedStats };

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
