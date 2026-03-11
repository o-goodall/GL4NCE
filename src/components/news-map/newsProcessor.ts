import type { NewsEvent, EventSeverity, EventCategory, AlertLevel, CountryNewsData, NewsMapData } from "./types";
import { KEYWORD_MAP, UNIQUE_COUNTRIES } from "./countryData";

// Sorted keywords longest-first — pre-computed once to avoid repeated sorting during article processing
const SORTED_KEYWORDS = [...KEYWORD_MAP.keys()].sort((a, b) => b.length - a.length);

// ── Classification keyword lists ──────────────────────────────────────────────
// Ordered most-specific / most-severe first so the earliest match wins.
// New categories (terrorism, cyber, health, etc.) are checked before the
// legacy broad categories so that specific patterns are not swallowed by
// generic violence or minor-event keywords.

// ── Terrorism ────────────────────────────────────────────────────────────────
const HIGH_TERRORISM = [
  "terrorist attack", "suicide bomb", "suicide bomber", "suicide bombing",
  "car bomb", "car bombing", "vehicle ramming",
  "isis attack", "isil attack", "al-qaeda attack", "al qaeda attack",
  "jihadist attack", "jihadi attack", "islamist attack",
  "coordinated attack", "mass casualty attack",
  "terror plot", "terror attack",
];
const MEDIUM_TERRORISM = [
  "terrorism", "terrorist", "jihadist", "jihadists", "islamist militant",
  "isis", "isil", "al-qaeda", "al qaeda", "boko haram", "hamas attack",
  "hezbollah attack", "ied detonated", "ied explosion",
  "terror suspect", "terror cell", "terror threat", "bomb threat",
];

// ── Cyber ─────────────────────────────────────────────────────────────────────
const HIGH_CYBER = [
  "cyberattack", "cyber attack", "ransomware attack", "ransomware",
  "state-sponsored hack", "state sponsored hack",
  "critical infrastructure hack", "power grid hack", "power grid attack",
  "government systems hacked", "election interference hack",
  "data breach", "massive data breach",
];
const MEDIUM_CYBER = [
  "cyber espionage", "cyber warfare", "ddos attack", "ddos",
  "malware campaign", "phishing campaign", "hacking campaign",
  "network intrusion", "systems compromised", "systems breached",
  "zero-day exploit", "zero day exploit",
  "national security breach", "intelligence hack",
];

// ── Health / Pandemic ─────────────────────────────────────────────────────────
const HIGH_HEALTH = [
  "pandemic", "global pandemic", "health emergency", "public health emergency",
  "disease outbreak", "outbreak declared", "epidemic outbreak",
  "mass casualty disease", "virus spreading", "pathogen outbreak",
  "covid", "ebola", "mpox", "monkeypox", "plague outbreak",
  "who declares emergency", "health crisis",
];
const MEDIUM_HEALTH = [
  "epidemic", "disease spread", "outbreak", "quarantine",
  "vaccination campaign", "vaccine shortage", "drug-resistant",
  "cholera", "measles outbreak", "dengue outbreak", "malaria surge",
  "mass vaccination", "contact tracing", "health alert",
];

// ── Environmental / Climate ───────────────────────────────────────────────────
const HIGH_ENVIRONMENTAL = [
  "catastrophic wildfire", "massive wildfire", "wildfire emergency",
  "climate emergency", "climate catastrophe",
  "catastrophic flooding", "extreme flooding", "flash flood kills",
  "category 5", "major hurricane", "super typhoon",
  "ecological disaster", "environmental catastrophe",
];
const MEDIUM_ENVIRONMENTAL = [
  "wildfire", "forest fire", "bushfire",
  "flooding", "floods", "flood warning",
  "drought emergency", "water crisis",
  "hurricane", "typhoon", "cyclone",
  "heatwave", "extreme heat", "record temperatures",
  "pollution crisis", "toxic spill",
  "deforestation", "environmental damage",
];

// ── Disaster (natural / humanitarian) ────────────────────────────────────────
const HIGH_DISASTER = [
  "major earthquake", "devastating earthquake", "earthquake kills",
  "tsunami warning", "tsunami hits",
  "volcanic eruption", "volcano erupts",
  "humanitarian catastrophe", "mass displacement",
  "famine declared", "starvation crisis",
];
const MEDIUM_DISASTER = [
  "earthquake", "tsunami", "volcanic",
  "humanitarian crisis", "humanitarian emergency",
  "refugee crisis", "displaced persons", "mass evacuation",
  "famine", "drought", "food insecurity",
  "aid workers", "relief operations",
];

// ── Infrastructure ────────────────────────────────────────────────────────────
const HIGH_INFRASTRUCTURE = [
  "infrastructure attack", "pipeline attack", "power grid down",
  "communications blackout", "internet shutdown",
  "bridge collapse", "dam collapse",
  "water supply contaminated", "water system attack",
  "port blocked", "supply route cut",
];
const MEDIUM_INFRASTRUCTURE = [
  "power outage", "blackout", "grid failure",
  "pipeline disruption", "pipeline explosion",
  "communications disrupted", "satellite disruption",
  "critical infrastructure",
];

// ── Crime / Organised Crime ───────────────────────────────────────────────────
const HIGH_CRIME = [
  "cartel massacre", "gang massacre", "cartel war",
  "drug cartel kills", "organised crime killing", "mob hit",
  "human trafficking network", "human smuggling network",
  "arms trafficking bust", "drug trafficking bust",
];
const MEDIUM_CRIME = [
  "cartel", "drug trafficking", "drug cartel", "narco",
  "organised crime", "organized crime", "criminal gang",
  "gang war", "gang violence", "mafia", "mob violence",
  "human trafficking", "arms smuggling", "money laundering",
  "kidnap for ransom",
];

// ── Piracy / Maritime Security ────────────────────────────────────────────────
const HIGH_PIRACY = [
  "ship hijacked", "vessel hijacked", "vessel seized",
  "pirates attack", "piracy attack", "maritime attack",
  "sailors held hostage", "crew kidnapped",
];
const MEDIUM_PIRACY = [
  "piracy", "pirates", "pirate",
  "maritime security incident", "shipping lane attack",
  "houthi ship attack", "houthi vessel", "red sea attack",
  "tanker seized", "cargo ship attacked",
];

// ── Diplomatic ────────────────────────────────────────────────────────────────
const HIGH_DIPLOMATIC = [
  "peace talks collapse", "ceasefire collapse", "peace deal collapsed",
  "diplomatic rupture", "diplomatic relations severed",
  "ambassador expelled", "expels ambassador", "ambassador recalled",
];
const MEDIUM_DIPLOMATIC = [
  "peace talks", "peace deal", "ceasefire agreement",
  "diplomatic talks", "summit meeting", "state visit",
  "trade negotiations", "bilateral talks",
  "diplomatic incident", "persona non grata",
  "foreign minister meets", "secretary of state meets",
];

// ── Military ──────────────────────────────────────────────────────────────────
const HIGH_MILITARY = [
  "military offensive", "military invasion", "ground offensive",
  "military operation launched", "combat operation",
  "troops advance", "forces seize", "military assault",
];
const MEDIUM_MILITARY = [
  "military operation", "special operation", "military exercise",
  "defense contract", "military aid", "arms delivery", "weapons delivery",
  "troop withdrawal", "military withdrawal", "peacekeeping mission",
  "military deployment", "naval patrol",
  "defense spending", "military budget",
  // Carrier groups / fleet tracking
  "carrier strike group", "carrier battle group", "carrier group",
  "fleet deployment", "naval task force", "amphibious ready group",
  // Defense procurement / arms deals
  "defense procurement", "arms procurement", "weapons contract", "arms contract",
  "military readiness", "force posture", "combat readiness",
];

// ── Commodities / Resource Supply ────────────────────────────────────────────
const HIGH_COMMODITIES = [
  "oil price surge", "oil price crash", "oil embargo",
  "gas supply cut", "energy supply crisis",
  "wheat shortage", "grain embargo", "food prices surge",
  "commodity shortage", "crop failure", "harvest failure",
  "fuel shortage", "petrol shortage",
];
const MEDIUM_COMMODITIES = [
  "oil prices", "gas prices", "energy prices",
  "wheat prices", "grain prices", "food prices",
  "commodity markets", "supply disruption",
  "opec", "oil production cut", "lng supply",
];

// ── Protest / Civil Unrest ───────────────────────────────────────────────────
const MEDIUM_PROTEST = [
  "protests", "protesters", "protest", "protesters take to the streets",
  "mass protest", "nationwide protest", "general strike",
  "worker strike", "workers strike", "trade union strike",
  "demonstration", "demonstrators", "march",
  "civil disobedience", "sit-in",
];

// ── Violent ──────────────────────────────────────────────────────────────────
const HIGH_VIOLENT = [
  "bombing", "explosion",
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
  "civil unrest", "blockade", "curfew", "evacuation",
  "social unrest", "tension", "dispute",
  // Humanitarian / disaster terms
  "refugee", "refugees", "displaced", "displacement",
  "humanitarian", "aid convoy",
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
  "warships deployed", "naval standoff", "aircraft carrier deployed",
  "tanks at border", "forces at border",
  // Diplomatic breakdown
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
  // Missile / weapons tests (provocative, not yet active combat)
  "missile test", "weapons test", "missile test launch", "test fired",
  "test launch", "rocket test", "nuclear test",
  // NATO posture / readiness escalation
  "nato alert", "nato readiness", "nato force posture",
  "nato mobilization", "nato mobilisation",
];

/**
 * Build a single precompiled RegExp from a keyword list.
 * Joining all keywords with `|` means V8's regex engine scans the lowercased
 * text in one pass rather than calling String.prototype.includes() once per
 * keyword.  Metacharacters in keywords are escaped so they match literally.
 * Using case-sensitive matching here because callers always lowercase the text
 * before calling classifyEvent — faster than the `i` flag.
 */
function buildClassifyRe(keywords: string[]): RegExp {
  return new RegExp(
    keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  );
}

// Precompiled once at module load — reused for every article.
const RE_HIGH_TERRORISM       = buildClassifyRe(HIGH_TERRORISM);
const RE_MEDIUM_TERRORISM     = buildClassifyRe(MEDIUM_TERRORISM);
const RE_HIGH_CYBER           = buildClassifyRe(HIGH_CYBER);
const RE_MEDIUM_CYBER         = buildClassifyRe(MEDIUM_CYBER);
const RE_HIGH_HEALTH          = buildClassifyRe(HIGH_HEALTH);
const RE_MEDIUM_HEALTH        = buildClassifyRe(MEDIUM_HEALTH);
const RE_HIGH_ENVIRONMENTAL   = buildClassifyRe(HIGH_ENVIRONMENTAL);
const RE_MEDIUM_ENVIRONMENTAL = buildClassifyRe(MEDIUM_ENVIRONMENTAL);
const RE_HIGH_DISASTER        = buildClassifyRe(HIGH_DISASTER);
const RE_MEDIUM_DISASTER      = buildClassifyRe(MEDIUM_DISASTER);
const RE_HIGH_INFRASTRUCTURE  = buildClassifyRe(HIGH_INFRASTRUCTURE);
const RE_MEDIUM_INFRASTRUCTURE= buildClassifyRe(MEDIUM_INFRASTRUCTURE);
const RE_HIGH_CRIME           = buildClassifyRe(HIGH_CRIME);
const RE_MEDIUM_CRIME         = buildClassifyRe(MEDIUM_CRIME);
const RE_HIGH_PIRACY          = buildClassifyRe(HIGH_PIRACY);
const RE_MEDIUM_PIRACY        = buildClassifyRe(MEDIUM_PIRACY);
const RE_HIGH_DIPLOMATIC      = buildClassifyRe(HIGH_DIPLOMATIC);
const RE_MEDIUM_DIPLOMATIC    = buildClassifyRe(MEDIUM_DIPLOMATIC);
const RE_HIGH_MILITARY        = buildClassifyRe(HIGH_MILITARY);
const RE_MEDIUM_MILITARY      = buildClassifyRe(MEDIUM_MILITARY);
const RE_HIGH_COMMODITIES     = buildClassifyRe(HIGH_COMMODITIES);
const RE_MEDIUM_COMMODITIES   = buildClassifyRe(MEDIUM_COMMODITIES);
const RE_MEDIUM_PROTEST       = buildClassifyRe(MEDIUM_PROTEST);
const RE_HIGH_ECONOMIC        = buildClassifyRe(HIGH_ECONOMIC);
const RE_HIGH_EXTREMISM       = buildClassifyRe(HIGH_EXTREMISM);
const RE_MEDIUM_EXTREMISM     = buildClassifyRe(MEDIUM_EXTREMISM);
const RE_HIGH_ESCALATION      = buildClassifyRe(HIGH_ESCALATION);
const RE_MEDIUM_ESCALATION    = buildClassifyRe(MEDIUM_ESCALATION);
const RE_HIGH_VIOLENT         = buildClassifyRe(HIGH_VIOLENT);
const RE_MEDIUM_VIOLENT       = buildClassifyRe(MEDIUM_VIOLENT);
const RE_LOW_MINOR            = buildClassifyRe(LOW_MINOR);

const TRENDING_THRESHOLD = 3;
const SEVERITY_WEIGHTS: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 };
/** Multipliers by category — conflict/terrorism signals get extra weight for alert-level scoring */
const CATEGORY_SCORE_MULTIPLIERS: Record<EventCategory, number> = {
  violent:        2.0,
  terrorism:      2.0,  // terrorism is treated as equal weight to direct conflict
  military:       1.8,  // active military operations = high urgency
  escalation:     1.8,
  diplomatic:     1.4,  // diplomatic crises can precede conflict
  extremism:      1.3,
  cyber:          1.3,  // state-level cyber incidents are significant
  health:         1.2,  // pandemics affect large populations
  infrastructure: 1.2,  // critical infrastructure attacks
  commodities:    1.0,
  economic:       1.0,
  piracy:         1.0,
  crime:          0.9,
  environmental:  0.8,
  disaster:       0.8,
  protest:        0.6,
  minor:          0.5,
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

/** Classify an article's severity and category */
export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  // ── Specific categories first (highest precision) ─────────────────────────
  // Terrorism — checked before generic violence so "terrorist attack kills 5"
  // routes to terrorism rather than violent.
  if (RE_HIGH_TERRORISM.test(lower))       return { severity: "high",   category: "terrorism"     };
  if (RE_MEDIUM_TERRORISM.test(lower))     return { severity: "medium", category: "terrorism"     };
  // Cyber — highly specific technical vocabulary
  if (RE_HIGH_CYBER.test(lower))           return { severity: "high",   category: "cyber"         };
  if (RE_MEDIUM_CYBER.test(lower))         return { severity: "medium", category: "cyber"         };
  // Piracy — specific maritime terms
  if (RE_HIGH_PIRACY.test(lower))          return { severity: "high",   category: "piracy"        };
  if (RE_MEDIUM_PIRACY.test(lower))        return { severity: "medium", category: "piracy"        };
  // Crime — organised crime / cartels (before generic violent)
  if (RE_HIGH_CRIME.test(lower))           return { severity: "high",   category: "crime"         };
  if (RE_MEDIUM_CRIME.test(lower))         return { severity: "medium", category: "crime"         };
  // Health — pandemic / outbreak signals (before minor to elevate severity)
  if (RE_HIGH_HEALTH.test(lower))          return { severity: "high",   category: "health"        };
  if (RE_MEDIUM_HEALTH.test(lower))        return { severity: "medium", category: "health"        };
  // Military operations (before escalation to distinguish active ops from threats)
  if (RE_HIGH_MILITARY.test(lower))        return { severity: "high",   category: "military"      };
  if (RE_MEDIUM_MILITARY.test(lower))      return { severity: "medium", category: "military"      };
  // Diplomatic — peace / negotiations (before escalation)
  if (RE_HIGH_DIPLOMATIC.test(lower))      return { severity: "high",   category: "diplomatic"    };
  if (RE_MEDIUM_DIPLOMATIC.test(lower))    return { severity: "medium", category: "diplomatic"    };
  // Commodities — resource / supply shocks (before generic economic)
  if (RE_HIGH_COMMODITIES.test(lower))     return { severity: "high",   category: "commodities"   };
  if (RE_MEDIUM_COMMODITIES.test(lower))   return { severity: "medium", category: "commodities"   };
  // Infrastructure — before minor to elevate severity
  if (RE_HIGH_INFRASTRUCTURE.test(lower))  return { severity: "high",   category: "infrastructure"};
  if (RE_MEDIUM_INFRASTRUCTURE.test(lower))return { severity: "medium", category: "infrastructure"};
  // Environmental — before minor / disaster
  if (RE_HIGH_ENVIRONMENTAL.test(lower))   return { severity: "high",   category: "environmental" };
  if (RE_MEDIUM_ENVIRONMENTAL.test(lower)) return { severity: "medium", category: "environmental" };
  // Natural / humanitarian disasters
  if (RE_HIGH_DISASTER.test(lower))        return { severity: "high",   category: "disaster"      };
  if (RE_MEDIUM_DISASTER.test(lower))      return { severity: "medium", category: "disaster"      };
  // ── Legacy broad categories ───────────────────────────────────────────────
  // Economic crises — distinct from violence; checked before violence keywords
  if (RE_HIGH_ECONOMIC.test(lower))        return { severity: "high",   category: "economic"      };
  // Extremism (ideologically motivated hate / movements)
  if (RE_HIGH_EXTREMISM.test(lower))       return { severity: "high",   category: "extremism"     };
  if (RE_MEDIUM_EXTREMISM.test(lower))     return { severity: "medium", category: "extremism"     };
  // Pre-conflict escalation signals — checked BEFORE generic violence so that
  // "killed during coup attempt" maps to escalation, not just violent.
  if (RE_HIGH_ESCALATION.test(lower))      return { severity: "high",   category: "escalation"    };
  if (RE_MEDIUM_ESCALATION.test(lower))    return { severity: "medium", category: "escalation"    };
  // Active violent events
  if (RE_HIGH_VIOLENT.test(lower))         return { severity: "high",   category: "violent"       };
  if (RE_MEDIUM_VIOLENT.test(lower))       return { severity: "medium", category: "violent"       };
  // Civil demonstrations / protests
  if (RE_MEDIUM_PROTEST.test(lower))       return { severity: "low",    category: "protest"       };
  // Catch-all low-level / context events
  if (RE_LOW_MINOR.test(lower))            return { severity: "low",    category: "minor"         };
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

/**
 * Memoised ISO-8601 → epoch-ms conversion.
 * Each unique timestamp string is parsed only once; the result is reused
 * across isWithinRetentionWindow, computeAlertLevel, computeTrending, and
 * the events sort in aggregateCountries.  Cache is capped at 2 000 entries
 * and evicts the oldest entry on overflow (Map preserves insertion order).
 */
const _timeMsCache = new Map<string, number>();
function parseTimeMs(iso: string): number {
  let ms = _timeMsCache.get(iso);
  if (ms === undefined) {
    ms = new Date(iso).getTime();
    if (_timeMsCache.size >= 2000) {
      _timeMsCache.delete(_timeMsCache.keys().next().value as string);
    }
    _timeMsCache.set(iso, ms);
  }
  return ms;
}

function isWithinRetentionWindow(isoTime: string): boolean {
  return parseTimeMs(isoTime) >= Date.now() - RETENTION_HOURS * 3_600_000;
}

/**
 * Compute a country's alert level from its recent events and trending status.
 * The weighted score combines severity × category multiplier for the last 24 h.
 */
function computeAlertLevel(events: NewsEvent[], isTrending: boolean): AlertLevel {
  const cutoff24h = Date.now() - 24 * 3_600_000;
  const recent = events.filter((e) => parseTimeMs(e.time) >= cutoff24h);
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
    const evTime = parseTimeMs(ev.time);
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
      events: evs.sort((a, b) => parseTimeMs(b.time) - parseTimeMs(a.time)),
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
 * Links are omitted from mock events: they are synthetic demo data and any
 * hardcoded URL would only land on a generic section page, not the specific
 * article.  Real RSS events always carry the article permalink from the feed.
 */
export function generateMockData(): NewsMapData {
  const now = new Date();
  const h = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

  const mockEvents: Omit<NewsEvent, "countryCode">[] = [
    // ── Australia: WA Police foil terror attack ───────────────────────────────
    // Both stories from the same source; requires a second source for trending
    { title: "WA police foil alleged mass terror attack linked to white supremacist group", source: "Guardian", time: h(0.5), country: "Australia", severity: "high", category: "extremism" },
    { title: "Roger Cook condemns dog whistling after police lay charges against white supremacist", source: "Guardian", time: h(0.7), country: "Australia", severity: "medium", category: "extremism" },
    // ── Iran × Israel: active conflict (fires conflict-group trending) ──────────
    { title: "Iran fires ballistic missiles toward Israeli-linked targets in latest escalation", source: "Al Jazeera", time: h(0.3), country: "Iran",          severity: "high",   category: "violent"    },
    { title: "IRGC deploys additional strike forces as regional tensions surge",                 source: "BBC",        time: h(0.6), country: "Iran",          severity: "high",   category: "escalation" },
    { title: "Mass protests turn violent outside Tehran parliament building",                    source: "DW",         time: h(0.9), country: "Iran",          severity: "high",   category: "violent"    },
    { title: "IDF launches retaliatory airstrikes on Iranian proxy positions in Syria",          source: "BBC",        time: h(0.4), country: "Israel",        severity: "high",   category: "violent"    },
    { title: "Israeli cabinet convenes emergency security meeting after missile barrage",        source: "Guardian",   time: h(0.8), country: "Israel",        severity: "high",   category: "escalation" },
    // ── Escalation demo events ───────────────────────────────────────────────
    { title: "North Korea launches ballistic missile over Sea of Japan in new provocation",     source: "BBC",        time: h(2),   country: "North Korea",  severity: "high",   category: "escalation" },
    { title: "Troops deployed to disputed border amid military buildup concerns",               source: "Al Jazeera", time: h(3),   country: "Pakistan",     severity: "medium", category: "escalation" },
    { title: "Coup attempt foiled as soldiers surrounding parliament are repelled",             source: "Guardian",   time: h(5),   country: "Ethiopia",     severity: "high",   category: "escalation" },
    { title: "State of emergency declared following nationwide civil unrest",                   source: "BBC",        time: h(6),   country: "Myanmar",      severity: "medium", category: "escalation" },
    // ── Ongoing conflict ─────────────────────────────────────────────────────
    { title: "Explosion near government building kills several",           source: "Al Jazeera", time: h(1),   country: "Iraq",          severity: "high",   category: "violent"  },
    { title: "Airstrike targets militant positions in northern region",    source: "BBC",        time: h(2),   country: "Syria",         severity: "high",   category: "violent"  },
    { title: "Missile strike reported on port city",                       source: "Al Jazeera", time: h(1.5), country: "Yemen",         severity: "high",   category: "violent"  },
    { title: "Casualties reported after drone strike",                     source: "BBC",        time: h(3),   country: "Ukraine",       severity: "high",   category: "violent"  },
    { title: "Bombing attack on market leaves dozens dead",                source: "Guardian",   time: h(4),   country: "Afghanistan",   severity: "high",   category: "violent"  },
    // ── Terrorism ─────────────────────────────────────────────────────────────
    { title: "Mass casualties in coordinated terrorist attack on market",  source: "BBC",        time: h(2),   country: "Somalia",       severity: "high",   category: "terrorism"  },
    { title: "ISIS car bomb kills dozens in crowded marketplace",          source: "Al Jazeera", time: h(5),   country: "Iraq",          severity: "high",   category: "terrorism"  },
    // ── Military ──────────────────────────────────────────────────────────────
    { title: "Military offensive launched against rebel stronghold",       source: "BBC",        time: h(4),   country: "Myanmar",       severity: "high",   category: "military"   },
    // ── Diplomatic ────────────────────────────────────────────────────────────
    { title: "Peace talks collapse as both sides reject ceasefire terms",  source: "Guardian",   time: h(8),   country: "Ukraine",       severity: "high",   category: "diplomatic" },
    // ── Economic ─────────────────────────────────────────────────────────────
    { title: "Stock market crash wipes billions off exchange",             source: "BBC",        time: h(2),   country: "China",         severity: "high",   category: "economic" },
    { title: "Currency collapses amid economic meltdown",                  source: "Guardian",   time: h(6),   country: "Venezuela",     severity: "high",   category: "economic" },
    { title: "Banking crisis deepens as runs continue",                    source: "BBC",        time: h(8),   country: "Nigeria",       severity: "high",   category: "economic" },
    { title: "Trade embargo escalates trade war tensions",                 source: "Al Jazeera", time: h(3),   country: "Russia",        severity: "high",   category: "economic" },
    // ── Commodities ───────────────────────────────────────────────────────────
    { title: "Oil price crash triggers emergency OPEC meeting",            source: "BBC",        time: h(3),   country: "Saudi Arabia",  severity: "high",   category: "commodities"},
    // ── Cyber ─────────────────────────────────────────────────────────────────
    { title: "State-sponsored cyberattack takes down government systems",  source: "BBC",        time: h(3),   country: "Estonia",       severity: "high",   category: "cyber"      },
    // ── Health ────────────────────────────────────────────────────────────────
    { title: "WHO declares public health emergency over new outbreak",     source: "BBC",        time: h(4),   country: "Congo",         severity: "high",   category: "health"     },
    // ── Environmental ─────────────────────────────────────────────────────────
    { title: "Catastrophic wildfires spread across southern region",       source: "BBC",        time: h(5),   country: "Greece",        severity: "high",   category: "environmental"},
    // ── Disaster ──────────────────────────────────────────────────────────────
    { title: "Major earthquake kills hundreds, rescue teams deployed",     source: "BBC",        time: h(6),   country: "Turkey",        severity: "high",   category: "disaster"   },
    // ── Infrastructure ────────────────────────────────────────────────────────
    { title: "Pipeline explosion disrupts energy supply to region",        source: "BBC",        time: h(7),   country: "Poland",        severity: "high",   category: "infrastructure"},
    // ── Crime ─────────────────────────────────────────────────────────────────
    { title: "Drug cartel massacre leaves dozens dead in northern province",source: "Guardian",  time: h(6),   country: "Mexico",        severity: "high",   category: "crime"      },
    // ── Piracy ────────────────────────────────────────────────────────────────
    { title: "Commercial vessel seized by pirates in Gulf of Aden",        source: "BBC",        time: h(8),   country: "Somalia",       severity: "high",   category: "piracy"     },
    // ── Unrest / minor ────────────────────────────────────────────────────────
    { title: "Riot police clash with demonstrators downtown",              source: "Guardian",   time: h(7),   country: "France",        severity: "medium", category: "violent"  },
    { title: "Armed confrontation near disputed border",                   source: "BBC",        time: h(10),  country: "India",         severity: "medium", category: "violent"  },
    { title: "Thousands march in peaceful climate demonstration",          source: "BBC",        time: h(4),   country: "Germany",       severity: "low",    category: "protest"  },
    { title: "Civil unrest follows disputed election results",             source: "Al Jazeera", time: h(11),  country: "Ethiopia",      severity: "low",    category: "minor"    },
    { title: "Evacuation ordered after minor earthquake",                  source: "DW",         time: h(15),  country: "Japan",         severity: "low",    category: "minor"    },
    { title: "Tensions rise as military buildup continues",                source: "DW",         time: h(8),   country: "North Korea",   severity: "low",    category: "minor"    },
    { title: "Violent clashes erupt at border crossing",                   source: "Al Jazeera", time: h(16),  country: "Myanmar",       severity: "medium", category: "violent"  },
    { title: "Kidnapping of journalists reported in conflict zone",        source: "Al Jazeera", time: h(12),  country: "Libya",         severity: "medium", category: "violent"  },
    // ── Extremism ─────────────────────────────────────────────────────────────
    { title: "Neo-nazi march through city centre draws counter-protests",  source: "Guardian",   time: h(5),   country: "Germany",       severity: "medium", category: "extremism" },
    { title: "Antisemitic attack on synagogue injures worshippers",        source: "BBC",        time: h(3),   country: "France",        severity: "high",   category: "extremism" },
    { title: "White supremacist rally triggers clashes with antifa groups",source: "Guardian",   time: h(9),   country: "United States", severity: "medium", category: "extremism" },
    { title: "Far-right extremist group banned after hate march",          source: "BBC",        time: h(14),  country: "United Kingdom",severity: "medium", category: "extremism" },
  ];

  const eventWithCodes: NewsEvent[] = mockEvents.map((e) => {
    const info = UNIQUE_COUNTRIES.find((c) => c.name === e.country);
    return { ...e, countryCode: info?.code ?? "UN" };
  }).filter((e) => e.countryCode !== "UN");

  return { ...aggregateCountries(eventWithCodes), usingMockData: true };
}
