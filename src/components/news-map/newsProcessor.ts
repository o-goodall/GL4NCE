import type { NewsEvent, EventSeverity, EventCategory, AlertLevel, CountryNewsData, NewsMapData } from "./types";
import { KEYWORD_MAP, UNIQUE_COUNTRIES } from "./countryData";

// Sorted keywords longest-first — pre-computed once to avoid repeated sorting during article processing
const SORTED_KEYWORDS = [...KEYWORD_MAP.keys()].sort((a, b) => b.length - a.length);

// ── Classification keyword lists ──────────────────────────────────────────────
// Ordered most-specific / most-severe first so the earliest match wins.

// ── Violent ──────────────────────────────────────────────────────────────────
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

// ── Civil unrest / minor / humanitarian ──────────────────────────────────────
const LOW_MINOR = [
  "peaceful protest", "demonstration", "march", "worker strike",
  "civil unrest", "blockade", "curfew", "evacuation",
  "power outage", "flooding", "earthquake", "storm",
  "social unrest", "tension", "dispute",
  // Humanitarian / disaster terms
  "refugee", "refugees", "displaced", "displacement",
  "humanitarian", "famine", "drought",
  "disease outbreak", "epidemic", "aid convoy",
];

// ── Economic ─────────────────────────────────────────────────────────────────
const HIGH_ECONOMIC = [
  "stock market crash", "market collapse", "market plunge",
  "hyperinflation", "currency collapse", "devaluation", "economic meltdown",
  "debt default", "sovereign default", "government default",
  "banking crisis", "bank run", "financial crisis",
  "severe sanctions", "trade embargo", "trade war",
  "mass unemployment", "factory closure", "supply chain collapse",
  "food shortage", "energy crisis",
];

// ── Extremism ─────────────────────────────────────────────────────────────────
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

// ── Escalation / pre-conflict — EARLY WARNING ─────────────────────────────────
// These signals precede active violence: military positioning, diplomatic breakdown,
// political seizures and WMD threats.  Detecting them earlier than violence keywords
// is the key to the "as early as possible" goal.
/** High-severity pre-conflict signals — imminent or acute crisis */
const HIGH_ESCALATION = [
  // Political seizures
  "coup attempt", "coup d'état", "attempted coup", "military takeover",
  "martial law", "state of emergency declared",
  // WMD / strategic weapons
  "nuclear threat", "nuclear alert", "nuclear readiness",
  "ballistic missile launched", "intercontinental missile", "hypersonic missile",
  "chemical attack", "chemical weapons used", "biological attack",
  // Airspace / major strategic moves
  "airspace closed", "airspace closure",
  "full military mobilization", "general mobilization",
];
/** Medium-severity pre-conflict signals — escalating but not yet at war */
const MEDIUM_ESCALATION = [
  // Military movements
  "troops deployed", "troops massing", "military buildup",
  "military mobilization", "mobilisation near",
  "military exercises", "war games", "live-fire drill",
  "warships deployed", "naval standoff", "aircraft carrier deployed",
  "tanks at border", "forces at border",
  // Diplomatic breakdown
  "expels ambassador", "ambassador expelled", "recalls ambassador",
  "diplomatic crisis", "severed diplomatic ties", "diplomatic breakdown",
  "new sanctions", "sanctions package", "sanctions announced",
  "border closed", "border closure", "border sealed",
  // Domestic crackdown
  "opposition arrested", "opposition leader arrested",
  "mass arrests", "protesters arrested", "crackdown on",
  "state of emergency", "emergency powers",
  "protest crackdown", "demonstrators detained",
  // Threat language
  "ultimatum", "war warning", "military threat",
  "brink of war", "on the brink", "armed standoff",
  "military standoff", "nuclear standoff",
  // Pre-coup signals
  "soldiers surrounding", "parliament surrounded",
  "president detained", "prime minister detained",
];

const TRENDING_THRESHOLD = 3;
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 };
/** Multipliers by category — escalation signals get extra weight for alert-level scoring */
const CATEGORY_SCORE_MULTIPLIERS: Record<EventCategory, number> = {
  violent:    2.0,
  escalation: 1.8,
  extremism:  1.3,
  economic:   1.0,
  minor:      0.5,
};
const RETENTION_HOURS = 48;
/** "Breaking" window: events within this many hours are scored as recent */
const TRENDING_RECENT_HOURS = 1;
/** Baseline window: the hours beyond TRENDING_RECENT_HOURS used to measure ongoing coverage */
const TRENDING_BASELINE_HOURS = 5;
/** Characters used for per-country story dedup key within the trending window */
const DEDUP_TITLE_LENGTH = 40;
/** All countries with velocity ≥ this fraction of the leader are co-trending */
const VELOCITY_FLOOR = 1.2;
/** Minimum distinct recent stories a country must have to qualify as trending */
const MIN_STORIES_TO_TREND = 2;
/** Minimum number of distinct sources that must report on a country for it to trend.
 *  Prevents a single outlet publishing two related articles from triggering trending. */
const MIN_SOURCES_TO_TREND = 2;
/** Hard cap on concurrent trending countries (keeps UI scannable) */
const MAX_TRENDING = 3;

/**
 * Known active conflicts / wars.  When any trending country is a member of one
 * of these groups AND the partner country(ies) also have recent events, all
 * active members are surfaced together.
 */
export const CONFLICT_GROUPS: readonly (readonly string[])[] = [
  ["RU", "UA"],     // Russia – Ukraine
  ["IL", "IR"],     // Israel – Iran
  ["IL", "PS"],     // Israel – Palestine / Gaza
  ["IL", "LB"],     // Israel – Hezbollah / Lebanon
  ["US", "CN"],     // US – China
  ["IN", "PK"],     // India – Pakistan
  ["KP", "KR"],     // North Korea – South Korea
  ["AM", "AZ"],     // Armenia – Azerbaijan
  ["SD", "SS"],     // Sudan – South Sudan
] as const;

/** Check if any keyword is contained in the text */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Classify an article's severity and category */
export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  // Economic crises first — they are distinct from violence and should not be
  // overridden by later violence keywords in the same headline.
  if (matchesAny(lower, HIGH_ECONOMIC))     return { severity: "high",   category: "economic"    };
  // Extremism attacks (ideologically motivated violence)
  if (matchesAny(lower, HIGH_EXTREMISM))    return { severity: "high",   category: "extremism"   };
  if (matchesAny(lower, MEDIUM_EXTREMISM))  return { severity: "medium", category: "extremism"   };
  // Pre-conflict escalation signals — checked BEFORE generic violence so that
  // "killed during coup attempt" maps to escalation, not just violent.
  if (matchesAny(lower, HIGH_ESCALATION))   return { severity: "high",   category: "escalation"  };
  if (matchesAny(lower, MEDIUM_ESCALATION)) return { severity: "medium", category: "escalation"  };
  // Active violent events
  if (matchesAny(lower, HIGH_VIOLENT))      return { severity: "high",   category: "violent"     };
  if (matchesAny(lower, MEDIUM_VIOLENT))    return { severity: "medium", category: "violent"     };
  // Civil unrest / humanitarian / minor
  if (matchesAny(lower, LOW_MINOR))         return { severity: "low",    category: "minor"       };
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
  const cutoffMs = Date.now() - RETENTION_HOURS * 3_600_000;
  return eventMs >= cutoffMs;
}

/**
 * Compute a country's alert level from its recent events and trending status.
 * The weighted score combines severity × category multiplier for the last 24 h.
 */
function computeAlertLevel(events: NewsEvent[], isTrending: boolean): AlertLevel {
  const cutoff24h = Date.now() - 24 * 3_600_000;
  const recent = events.filter((e) => new Date(e.time).getTime() >= cutoff24h);
  const pool = recent.length > 0 ? recent : events;
  const score = pool.reduce(
    (sum, ev) => sum + SEVERITY_WEIGHTS[ev.severity] * CATEGORY_SCORE_MULTIPLIERS[ev.category],
    0
  );
  if (isTrending && score >= 10) return "critical";
  if (score >= 20)               return "critical";
  if (score >= 8 || isTrending)  return "high";
  if (score >= 3)                return "medium";
  return "watch";
}

/**
 * Multi-country trending detection.
 *
 * Returns ALL countries whose news velocity clears the absolute floor
 * (VELOCITY_FLOOR), up to MAX_TRENDING.  A country must have at least
 * MIN_STORIES_TO_TREND distinct recent stories to qualify — a single viral
 * story cannot trigger trending.  Conflict-group partners are recorded for
 * informational use but do NOT automatically inherit trending status.
 *
 * This replaces the previous single-winner approach, giving much earlier
 * simultaneous warning across multiple active crises.
 */
function computeTrending(events: NewsEvent[]): { trending: Set<string>; trendingRanks: Map<string, number>; conflictGroups: string[][] } {
  const now = Date.now();
  const recentCutoff   = now - TRENDING_RECENT_HOURS   * 3_600_000;
  const baselineCutoff = now - (TRENDING_RECENT_HOURS + TRENDING_BASELINE_HOURS) * 3_600_000;

  const recentScores:          Record<string, number>        = {};
  const baselineScores:        Record<string, number>        = {};
  const recentStoryCount:      Record<string, number>        = {};
  const recentSourcesPerCountry: Record<string, Set<string>> = {};
  const seenPerCountry = new Map<string, Set<string>>();
  // Collected in the same loop to avoid a second pass + date re-parsing below
  const codesWithEvents = new Set<string>();

  for (const ev of events) {
    const evTime = new Date(ev.time).getTime();
    if (evTime < baselineCutoff) continue;

    // Every event within the window counts as "active" for conflict-group linking
    codesWithEvents.add(ev.countryCode);

    const storyKey = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    let seen = seenPerCountry.get(ev.countryCode);
    if (!seen) { seen = new Set(); seenPerCountry.set(ev.countryCode, seen); }
    if (seen.has(storyKey)) continue;
    seen.add(storyKey);

    const weight = SEVERITY_WEIGHTS[ev.severity];
    if (evTime >= recentCutoff) {
      recentScores[ev.countryCode]     = (recentScores[ev.countryCode]     ?? 0) + weight;
      recentStoryCount[ev.countryCode] = (recentStoryCount[ev.countryCode] ?? 0) + 1;
      (recentSourcesPerCountry[ev.countryCode] ??= new Set()).add(ev.source);
    } else {
      baselineScores[ev.countryCode] = (baselineScores[ev.countryCode] ?? 0) + weight;
    }
  }

  // Compute velocity for each country that cleared both the score threshold,
  // the minimum distinct story count, and the minimum distinct source count.
  const eligible: { code: string; velocity: number }[] = [];
  for (const [code, recentScore] of Object.entries(recentScores)) {
    if (recentScore < TRENDING_THRESHOLD) continue;
    if ((recentStoryCount[code] ?? 0) < MIN_STORIES_TO_TREND) continue;
    if ((recentSourcesPerCountry[code]?.size ?? 0) < MIN_SOURCES_TO_TREND) continue;
    const baselineRate = (baselineScores[code] ?? 0) / TRENDING_BASELINE_HOURS;
    // Ensure the divisor is at least 1 so countries with zero baseline still score well.
    const velocity = recentScore / Math.max(baselineRate, 1);
    eligible.push({ code, velocity });
  }

  if (eligible.length === 0) return { trending: new Set(), trendingRanks: new Map(), conflictGroups: [] };

  // Sort by velocity descending; keep all countries above the absolute floor
  // and cap at MAX_TRENDING so the UI stays scannable.
  eligible.sort((a, b) => b.velocity - a.velocity);
  const trendingList = eligible
    .filter((e) => e.velocity >= VELOCITY_FLOOR)
    .slice(0, MAX_TRENDING);

  const trending = new Set(trendingList.map((e) => e.code));
  // 1-based rank map for the ordered trending list
  const trendingRanks = new Map(trendingList.map((e, i) => [e.code, i + 1]));

  // Record active conflict groups for informational use only — partners do NOT
  // inherit trending status automatically; they must qualify independently.
  // seenGroups prevents the same group appearing twice if both members trend.
  const seenGroups = new Set<string>();
  const activeConflictGroups: string[][] = [];
  for (const { code: tCode } of trendingList) {
    for (const group of CONFLICT_GROUPS) {
      if (!group.includes(tCode)) continue;
      const groupKey = [...group].sort().join("-");
      if (seenGroups.has(groupKey)) continue;
      const activeMembers = (group as readonly string[]).filter((c) => codesWithEvents.has(c));
      if (activeMembers.length >= 2) {
        activeConflictGroups.push(activeMembers);
        seenGroups.add(groupKey);
      }
    }
  }

  return { trending, trendingRanks, conflictGroups: activeConflictGroups };
}

/** Aggregate events into per-country data */
export function aggregateCountries(events: NewsEvent[]): NewsMapData {
  const recent = events.filter((e) => isWithinRetentionWindow(e.time));
  const { trending, trendingRanks, conflictGroups } = computeTrending(recent);

  const byCode: Record<string, NewsEvent[]> = {};
  for (const ev of recent) {
    (byCode[ev.countryCode] ??= []).push(ev);
  }

  const countries: CountryNewsData[] = Object.entries(byCode).map(([code, evs]) => {
    const info = KEYWORD_MAP.get(code.toLowerCase());
    const isTrending = trending.has(code);
    return {
      code,
      name: evs[0].country,
      lat: info?.lat ?? 0,
      lng: info?.lng ?? 0,
      trending: isTrending,
      trendingRank: isTrending ? (trendingRanks.get(code) ?? undefined) : undefined,
      alertLevel: computeAlertLevel(evs, isTrending),
      events: evs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
    };
  });

  return {
    countries,
    lastUpdated: new Date().toISOString(),
    ...(conflictGroups.length > 0 ? { conflictGroups } : {}),
  };
}

/**
 * Generate mock data — used as a fallback when the API is unavailable
 * (e.g. local dev without the Vercel runtime).
 */
export function generateMockData(): NewsMapData {
  const now = new Date();
  const h = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

  const mockEvents: Omit<NewsEvent, "countryCode">[] = [
    // ── Australia: WA Police foil terror attack ───────────────────────────────
    // Both stories from the same source; requires a second source for trending
    { title: "WA police foil alleged mass terror attack linked to white supremacist group", source: "Guardian", time: h(0.5), country: "Australia", severity: "high", category: "extremism", link: "https://www.theguardian.com/australia-news" },
    { title: "Roger Cook condemns dog whistling after police lay charges against white supremacist", source: "Guardian", time: h(0.7), country: "Australia", severity: "medium", category: "extremism", link: "https://www.theguardian.com/australia-news" },
    // ── Iran × Israel: active conflict (fires conflict-group trending) ──────────
    { title: "Iran fires ballistic missiles toward Israeli-linked targets in latest escalation", source: "Al Jazeera", time: h(0.3), country: "Iran",          severity: "high",   category: "violent",    link: "https://www.aljazeera.com/news/liveblog/iran-israel" },
    { title: "IRGC deploys additional strike forces as regional tensions surge",                 source: "BBC",        time: h(0.6), country: "Iran",          severity: "high",   category: "escalation", link: "https://www.bbc.com/news/world/middle-east" },
    { title: "Mass protests turn violent outside Tehran parliament building",                    source: "DW",         time: h(0.9), country: "Iran",          severity: "high",   category: "violent",    link: "https://www.dw.com/en/iran/t-37898" },
    { title: "IDF launches retaliatory airstrikes on Iranian proxy positions in Syria",          source: "BBC",        time: h(0.4), country: "Israel",        severity: "high",   category: "violent",    link: "https://www.bbc.com/news/world/middle-east" },
    { title: "Israeli cabinet convenes emergency security meeting after missile barrage",        source: "Guardian",   time: h(0.8), country: "Israel",        severity: "high",   category: "escalation", link: "https://www.theguardian.com/world/israel" },
    // ── Escalation demo events ───────────────────────────────────────────────
    { title: "North Korea launches ballistic missile over Sea of Japan in new provocation",     source: "BBC",        time: h(2),   country: "North Korea",  severity: "high",   category: "escalation", link: "https://www.bbc.com/news/world/asia" },
    { title: "Troops deployed to disputed border amid military buildup concerns",               source: "Al Jazeera", time: h(3),   country: "Pakistan",     severity: "medium", category: "escalation", link: "https://www.aljazeera.com/tag/pakistan/" },
    { title: "Coup attempt foiled as soldiers surrounding parliament are repelled",             source: "Guardian",   time: h(5),   country: "Ethiopia",     severity: "high",   category: "escalation", link: "https://www.theguardian.com/world/ethiopia" },
    { title: "State of emergency declared following nationwide civil unrest",                   source: "BBC",        time: h(6),   country: "Myanmar",      severity: "medium", category: "escalation", link: "https://www.bbc.com/news/world/asia" },
    // ── Ongoing conflict ─────────────────────────────────────────────────────
    { title: "Explosion near government building kills several",           source: "Al Jazeera", time: h(1),   country: "Iraq",          severity: "high",   category: "violent",   link: "https://www.aljazeera.com/tag/iraq/" },
    { title: "Airstrike targets militant positions in northern region",    source: "BBC",        time: h(2),   country: "Syria",         severity: "high",   category: "violent",   link: "https://www.bbc.com/news/topics/c2vdnvyt9jkt" },
    { title: "Missile strike reported on port city",                       source: "Al Jazeera", time: h(1.5), country: "Yemen",         severity: "high",   category: "violent",   link: "https://www.aljazeera.com/tag/yemen-conflict/" },
    { title: "Casualties reported after drone strike",                     source: "BBC",        time: h(3),   country: "Ukraine",       severity: "high",   category: "violent",   link: "https://www.bbc.com/news/world/europe" },
    { title: "Bombing attack on market leaves dozens dead",                source: "Guardian",   time: h(4),   country: "Afghanistan",   severity: "high",   category: "violent",   link: "https://www.theguardian.com/world/afghanistan" },
    // ── Economic ─────────────────────────────────────────────────────────────
    { title: "Stock market crash wipes billions off exchange",             source: "BBC",        time: h(2),   country: "China",         severity: "high",   category: "economic",  link: "https://www.bbc.com/news/business" },
    { title: "Currency collapses amid economic meltdown",                  source: "Guardian",   time: h(6),   country: "Venezuela",     severity: "high",   category: "economic",  link: "https://www.theguardian.com/world/venezuela" },
    { title: "Banking crisis deepens as runs continue",                    source: "BBC",        time: h(8),   country: "Nigeria",       severity: "high",   category: "economic",  link: "https://www.bbc.com/news/world/africa" },
    { title: "Trade embargo escalates trade war tensions",                 source: "Al Jazeera", time: h(3),   country: "Russia",        severity: "high",   category: "economic",  link: "https://www.aljazeera.com/tag/russia/" },
    // ── Unrest / minor ────────────────────────────────────────────────────────
    { title: "Riot police clash with demonstrators downtown",              source: "Guardian",   time: h(7),   country: "France",        severity: "medium", category: "violent",   link: "https://www.theguardian.com/world/france" },
    { title: "Armed confrontation near disputed border",                   source: "BBC",        time: h(10),  country: "India",         severity: "medium", category: "violent",   link: "https://www.bbc.com/news/world/south-asia" },
    { title: "Thousands march in peaceful climate demonstration",          source: "BBC",        time: h(4),   country: "Germany",       severity: "low",    category: "minor",     link: "https://www.bbc.com/news/world/europe" },
    { title: "Civil unrest follows disputed election results",             source: "Al Jazeera", time: h(11),  country: "Ethiopia",      severity: "low",    category: "minor",     link: "https://www.aljazeera.com/tag/ethiopia/" },
    { title: "Evacuation ordered after minor earthquake",                  source: "DW",         time: h(15),  country: "Japan",         severity: "low",    category: "minor",     link: "https://www.dw.com/en/asia/s-1395" },
    { title: "Food shortage worsens amid supply chain collapse",           source: "Al Jazeera", time: h(6),   country: "Sudan",         severity: "high",   category: "economic",  link: "https://www.aljazeera.com/tag/sudan/" },
    { title: "Mass casualties in coordinated terrorist attack",            source: "BBC",        time: h(2),   country: "Somalia",       severity: "high",   category: "violent",   link: "https://www.bbc.com/news/world/africa" },
    { title: "Tensions rise as military buildup continues",                source: "DW",         time: h(8),   country: "North Korea",   severity: "low",    category: "minor",     link: "https://www.dw.com/en/north-korea/t-36836" },
    { title: "Violent clashes erupt at border crossing",                   source: "Al Jazeera", time: h(16),  country: "Myanmar",       severity: "medium", category: "violent",   link: "https://www.aljazeera.com/tag/myanmar/" },
    { title: "Kidnapping of journalists reported in conflict zone",        source: "Al Jazeera", time: h(12),  country: "Libya",         severity: "medium", category: "violent",   link: "https://www.aljazeera.com/tag/libya/" },
    // ── Extremism ─────────────────────────────────────────────────────────────
    { title: "Neo-nazi march through city centre draws counter-protests",  source: "Guardian",   time: h(5),   country: "Germany",       severity: "medium", category: "extremism", link: "https://www.theguardian.com/world/germany" },
    { title: "Antisemitic attack on synagogue injures worshippers",        source: "BBC",        time: h(3),   country: "France",        severity: "high",   category: "extremism", link: "https://www.bbc.com/news/world/europe" },
    { title: "White supremacist rally triggers clashes with antifa groups",source: "Guardian",   time: h(9),   country: "United States", severity: "medium", category: "extremism", link: "https://www.theguardian.com/us-news" },
    { title: "Far-right extremist group banned after hate march",          source: "BBC",        time: h(14),  country: "United Kingdom",severity: "medium", category: "extremism", link: "https://www.bbc.com/news/uk" },
  ];

  const eventWithCodes: NewsEvent[] = mockEvents.map((e) => {
    const info = UNIQUE_COUNTRIES.find((c) => c.name === e.country);
    return { ...e, countryCode: info?.code ?? "UN" };
  }).filter((e) => e.countryCode !== "UN");

  return { ...aggregateCountries(eventWithCodes), usingMockData: true };
}
