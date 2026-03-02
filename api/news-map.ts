import type { IncomingMessage, ServerResponse } from "node:http";
import Parser from "rss-parser";
import { scoreCountries, calculateConfidence, getCountryByCode } from "./scoringEngine.js";
import { classifyEvent, cleanSnippet, OUTLET_NAME_RE, type EventSeverity, type EventCategory } from "./classifier.js";
import {
  RSS_SOURCES, TELEGRAM_CHANNELS, REDDIT_JSON_SUBREDDITS,
  SOURCE_WEIGHTS, CONFLICT_GROUPS,
  ARTICLES_PER_FEED, FETCH_TIMEOUT, MAX_CONCURRENT_FETCHES, NEWS_MAP_UA,
} from "./sources.js";

// ── Types (mirror src/components/news-map/types.ts) ─────────────────────────
type AlertLevel = "critical" | "high" | "medium" | "watch";

/** Number of characters used to build the deduplication key from a title.
 *  Short enough to also catch the same story re-published with a minor
 *  wording change (e.g. "kills 5" vs "kills at least 5"). */
const DEDUP_TITLE_LENGTH = 40;

interface NewsEvent {
  title: string;
  source: string;
  time: string;
  country: string;
  countryCode: string;
  severity: EventSeverity;
  category: EventCategory;
  link?: string;
  /** Deterministic score from the scoring engine */
  score?: number;
  /** Confidence that this is the correct country (0–1) */
  confidence?: number;
  /** Number of distinct sources that independently reported this story */
  confirmations?: number;
}

interface CountryNewsData {
  code: string;
  name: string;
  lat: number;
  lng: number;
  trending: boolean;
  /** 1-based rank among trending countries (1 = most trending); undefined for non-trending */
  trendingRank?: number;
  alertLevel: AlertLevel;
  events: NewsEvent[];
  /** Weighted event activity score over the rolling 7-day window (higher = more sustained conflict) */
  escalationIndex?: number;
}

interface NewsMapData {
  countries: CountryNewsData[];
  lastUpdated: string;
  usingMockData?: boolean;
  /** Feed health — how many sources responded successfully out of total attempted */
  feedStats?: { succeeded: number; total: number };
  /**
   * Groups of ISO-3166 country codes trending together because they are directly
   * involved in the same active conflict.  Each inner array has ≥ 2 codes.
   */
  conflictGroups?: string[][];
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
  { code: "JO", name: "Jordan", lat: 30.59, lng: 36.24, keywords: ["jordan", "jordanian", "amman"] },
  { code: "QA", name: "Qatar", lat: 25.35, lng: 51.18, keywords: ["qatar", "qatari", "doha"] },
  { code: "KW", name: "Kuwait", lat: 29.37, lng: 47.98, keywords: ["kuwait", "kuwaiti", "kuwait city"] },
  { code: "BH", name: "Bahrain", lat: 26.07, lng: 50.56, keywords: ["bahrain", "bahraini", "manama"] },
  { code: "OM", name: "Oman", lat: 21.47, lng: 55.97, keywords: ["oman", "omani", "muscat"] },
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
  { code: "BO", name: "Bolivia", lat: -16.29, lng: -63.59, keywords: ["bolivia", "bolivian", "la paz", "santa cruz", "cochabamba"] },
  { code: "PE", name: "Peru", lat: -9.19, lng: -75.02, keywords: ["peru", "peruvian", "lima", "arequipa"] },
  { code: "EC", name: "Ecuador", lat: -1.83, lng: -78.18, keywords: ["ecuador", "ecuadorian", "quito", "guayaquil"] },
  { code: "PY", name: "Paraguay", lat: -23.44, lng: -58.44, keywords: ["paraguay", "paraguayan", "asuncion"] },
  { code: "UY", name: "Uruguay", lat: -32.52, lng: -55.77, keywords: ["uruguay", "uruguayan", "montevideo"] },
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
  { code: "VN", name: "Vietnam", lat: 14.06, lng: 108.28, keywords: ["vietnam", "vietnamese", "hanoi", "ho chi minh", "saigon"] },
  { code: "MY", name: "Malaysia", lat: 4.21, lng: 101.97, keywords: ["malaysia", "malaysian", "kuala lumpur"] },
  { code: "KH", name: "Cambodia", lat: 12.57, lng: 104.99, keywords: ["cambodia", "cambodian", "phnom penh", "khmer"] },
  { code: "EG", name: "Egypt", lat: 26.82, lng: 30.80, keywords: ["egypt", "egyptian", "cairo", "sinai", "sisi"] },
  { code: "MA", name: "Morocco", lat: 31.79, lng: -7.09, keywords: ["morocco", "moroccan", "rabat", "casablanca"] },
  { code: "DZ", name: "Algeria", lat: 28.03, lng: 1.66, keywords: ["algeria", "algerian", "algiers"] },
  { code: "TN", name: "Tunisia", lat: 33.89, lng: 9.54, keywords: ["tunisia", "tunisian", "tunis"] },
  { code: "GH", name: "Ghana", lat: 7.95, lng: -1.02, keywords: ["ghana", "ghanaian", "accra"] },
  { code: "KE", name: "Kenya", lat: -0.02, lng: 37.91, keywords: ["kenya", "kenyan", "nairobi"] },
  { code: "TZ", name: "Tanzania", lat: -6.37, lng: 34.89, keywords: ["tanzania", "tanzanian", "dar es salaam", "dodoma"] },
  { code: "UG", name: "Uganda", lat: 1.37, lng: 32.29, keywords: ["uganda", "ugandan", "kampala"] },
  { code: "RW", name: "Rwanda", lat: -1.94, lng: 29.87, keywords: ["rwanda", "rwandan", "kigali"] },
  { code: "MZ", name: "Mozambique", lat: -18.67, lng: 35.53, keywords: ["mozambique", "mozambican", "maputo", "cabo delgado"] },
  { code: "ZW", name: "Zimbabwe", lat: -19.02, lng: 29.15, keywords: ["zimbabwe", "zimbabwean", "harare"] },
  { code: "AO", name: "Angola", lat: -11.20, lng: 17.87, keywords: ["angola", "angolan", "luanda"] },
  { code: "CM", name: "Cameroon", lat: 7.37, lng: 12.35, keywords: ["cameroon", "cameroonian", "yaounde", "douala"] },
  { code: "CI", name: "Ivory Coast", lat: 7.54, lng: -5.55, keywords: ["ivory coast", "ivorian", "abidjan", "cote d'ivoire", "côte d'ivoire"] },
  { code: "SN", name: "Senegal", lat: 14.50, lng: -14.45, keywords: ["senegal", "senegalese", "dakar"] },
  { code: "BF", name: "Burkina Faso", lat: 12.36, lng: -1.53, keywords: ["burkina faso", "burkinabe", "ouagadougou"] },
  { code: "NE", name: "Niger", lat: 17.61, lng: 8.08, keywords: ["nigerien", "niamey", "niger republic"] },
  { code: "UZ", name: "Uzbekistan", lat: 41.38, lng: 64.58, keywords: ["uzbekistan", "uzbek", "tashkent"] },
  { code: "KZ", name: "Kazakhstan", lat: 48.02, lng: 66.92, keywords: ["kazakhstan", "kazakh", "astana", "almaty"] },
  { code: "GE", name: "Georgia", lat: 42.32, lng: 43.36, keywords: ["georgia", "georgian", "tbilisi", "abkhazia", "south ossetia"] },
  { code: "AM", name: "Armenia", lat: 40.07, lng: 45.04, keywords: ["armenia", "armenian", "yerevan", "nagorno-karabakh", "karabakh"] },
  { code: "AZ", name: "Azerbaijan", lat: 40.14, lng: 47.58, keywords: ["azerbaijan", "azerbaijani", "baku"] },
  { code: "IT", name: "Italy", lat: 41.87, lng: 12.57, keywords: ["italy", "italian", "rome", "milan", "naples"] },
  { code: "ES", name: "Spain", lat: 40.46, lng: -3.75, keywords: ["spain", "spanish", "madrid", "barcelona", "catalonia"] },
  { code: "GR", name: "Greece", lat: 39.07, lng: 21.82, keywords: ["greece", "greek", "athens"] },
  { code: "HU", name: "Hungary", lat: 47.16, lng: 19.50, keywords: ["hungary", "hungarian", "budapest", "orban"] },
  { code: "SE", name: "Sweden", lat: 60.13, lng: 18.64, keywords: ["sweden", "swedish", "stockholm"] },
  { code: "NO", name: "Norway", lat: 60.47, lng: 8.47, keywords: ["norway", "norwegian", "oslo"] },
  { code: "CA", name: "Canada", lat: 56.13, lng: -106.35, keywords: ["canada", "canadian", "ottawa", "toronto", "trudeau"] },
  { code: "AU", name: "Australia", lat: -25.27, lng: 133.78, keywords: ["australia", "australian", "canberra", "sydney", "melbourne", "perth", "brisbane", "western australia", "wa police", "roger cook", "queensland", "new south wales", "victoria"] },
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
/** All countries with velocity ≥ this absolute floor are co-trending */
const VELOCITY_FLOOR = 1.2;
/** Minimum distinct recent stories a country must have to qualify as trending */
const MIN_STORIES_TO_TREND = 2;
/** Minimum number of distinct sources that must report on a country for it to trend.
 *  Prevents a single outlet publishing two related articles from triggering trending. */
const MIN_SOURCES_TO_TREND = 2;
/** Hard cap on concurrent trending countries (keeps UI scannable) */
const MAX_TRENDING = 3;
/** Maximum events retained per country in the response (prevents one country flooding the output) */
const MAX_EVENTS_PER_COUNTRY = 10;
/** Rolling window for the 7-day escalation index (ms) */
const ESCALATION_WINDOW_MS = 7 * 24 * 3_600_000;

/** Look up country info from the scoring-engine database by ISO code */
function getCountryInfoByCode(code: string) {
  return getCountryByCode(code) ?? KEYWORD_MAP.get(code.toLowerCase());
}

/**
 * Memoised ISO-8601 → epoch-ms conversion.
 * `new Date(iso).getTime()` is called across five separate pipeline functions
 * (isWithinRetentionWindow, computeTrending, computeAlertLevel,
 * computeEscalationIndex, and the events sort in aggregateCountries).
 * A single-string Map cache ensures each unique timestamp is parsed only once
 * per serverless instance lifetime.  The cache is bounded to ≤ 2000 entries
 * (48 h × ≈ 200 active events is well within this).  When the limit is hit the
 * oldest entry is evicted (Map preserves insertion order) rather than clearing
 * the entire cache, avoiding a thundering-herd re-parse on the next request.
 */
const _timeMsCache = new Map<string, number>();
function parseTimeMs(iso: string): number {
  let ms = _timeMsCache.get(iso);
  if (ms === undefined) {
    ms = new Date(iso).getTime();
    if (_timeMsCache.size >= 2000) {
      // Evict the oldest entry (Map iterator follows insertion order)
      _timeMsCache.delete(_timeMsCache.keys().next().value as string);
    }
    _timeMsCache.set(iso, ms);
  }
  return ms;
}

function isWithinRetentionWindow(isoTime: string): boolean {
  return Date.now() - parseTimeMs(isoTime) <= RETENTION_HOURS * 3_600_000;
}

/**
 * Time-decay multiplier for event scoring.  Recent events receive full weight;
 * older events are progressively down-weighted to emphasise breaking news.
 *   0–1 h  → 1.00
 *   1–6 h  → 0.85
 *   6–24 h → 0.65
 *  24–48 h → 0.50
 *    > 48 h → 0.30
 */
function recencyMultiplier(isoTime: string): number {
  const ageH = (Date.now() - parseTimeMs(isoTime)) / 3_600_000;
  if (ageH <= 1)  return 1.00;
  if (ageH <= 6)  return 0.85;
  if (ageH <= 24) return 0.65;
  if (ageH <= 48) return 0.50;
  return 0.30;
}

// ── Rolling 7-day escalation store ──────────────────────────────────────────
// Module-level accumulator that retains events across handler calls within the
// same serverless instance.  New events are appended on every request; events
// older than ESCALATION_WINDOW_MS are pruned.  This gives a rolling 7-day
// event-density signal per country even though each RSS fetch only returns the
// most recent articles.

/**
 * Per-country buckets for the 7-day escalation store.
 * Keyed by ISO-3166 country code — gives O(K_country) lookup in
 * computeEscalationIndex instead of O(N_total) full-array scan.
 */
const _escalationByCountry = new Map<string, NewsEvent[]>();
/** Flat dedup key set — O(1) insert-check regardless of bucket structure */
let _escalationKeys: Set<string> = new Set();

/** Append fresh events to the 7-day store, deduplicating on title prefix. */
function appendToEscalationStore(newEvents: NewsEvent[]): void {
  const cutoff = Date.now() - ESCALATION_WINDOW_MS;
  for (const ev of newEvents) {
    // Include country code so stories from different countries with the same
    // 40-char title prefix are never conflated into a single dedup slot.
    const key = `${ev.countryCode}:${ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH)}`;
    if (!_escalationKeys.has(key)) {
      _escalationKeys.add(key);
      const bucket = _escalationByCountry.get(ev.countryCode);
      if (bucket) bucket.push(ev);
      else _escalationByCountry.set(ev.countryCode, [ev]);
    }
  }
  // Prune stale events per bucket; rebuild key cache only when any pruning occurred.
  let didPrune = false;
  for (const [code, bucket] of _escalationByCountry) {
    const kept = bucket.filter((e) => parseTimeMs(e.time) >= cutoff);
    if (kept.length < bucket.length) {
      didPrune = true;
      if (kept.length > 0) _escalationByCountry.set(code, kept);
      else _escalationByCountry.delete(code);
    }
  }
  if (didPrune) {
    _escalationKeys = new Set();
    for (const bucket of _escalationByCountry.values()) {
      for (const ev of bucket) {
        _escalationKeys.add(`${ev.countryCode}:${ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH)}`);
      }
    }
  }
}

/**
 * Compute a weighted activity score for `countryCode` over the 7-day window.
 * Combines the persistent store with the current-request events for accuracy.
 * Higher values indicate more sustained or escalating activity.
 *
 * O(K_country) where K_country = events for this country in the 7-day store.
 * Previously O(N_total) because it scanned the entire flat store array.
 */
function computeEscalationIndex(countryCode: string, currentEvents: NewsEvent[]): number {
  const cutoff = Date.now() - ESCALATION_WINDOW_MS;
  const seen = new Set<string>();
  let score = 0;

  // Only iterate events for this country — O(K) not O(N_total)
  const stored = _escalationByCountry.get(countryCode) ?? [];
  for (const ev of stored) {
    if (parseTimeMs(ev.time) < cutoff) continue;
    const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    if (seen.has(key)) continue;
    seen.add(key);
    score += SEVERITY_WEIGHTS[ev.severity] * CATEGORY_SCORE_MULTIPLIERS[ev.category] * recencyMultiplier(ev.time);
  }
  for (const ev of currentEvents) {
    if (ev.countryCode !== countryCode) continue;
    if (parseTimeMs(ev.time) < cutoff) continue;
    const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    if (seen.has(key)) continue;
    seen.add(key);
    score += SEVERITY_WEIGHTS[ev.severity] * CATEGORY_SCORE_MULTIPLIERS[ev.category] * recencyMultiplier(ev.time);
  }
  return Math.round(score * 100) / 100;
}

/**
 * Compute a country's alert level from its recent events and trending status.
 * Applies recency weighting so breaking events within the last hour score highest.
 */
function computeAlertLevel(events: NewsEvent[], isTrending: boolean): AlertLevel {
  const cutoff24h = Date.now() - 24 * 3_600_000;
  const recent = events.filter((e) => parseTimeMs(e.time) >= cutoff24h);
  const pool = recent.length > 0 ? recent : events;
  const score = pool.reduce(
    (sum, ev) =>
      sum + SEVERITY_WEIGHTS[ev.severity] * CATEGORY_SCORE_MULTIPLIERS[ev.category] * recencyMultiplier(ev.time),
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
 * Returns ALL countries whose news velocity clears VELOCITY_FLOOR, up to
 * MAX_TRENDING.  A country must have at least MIN_STORIES_TO_TREND distinct
 * recent stories to qualify — a single viral story cannot trigger trending.
 * Conflict-group partners are recorded for informational use but do NOT
 * automatically inherit trending status.
 */
function computeTrending(events: NewsEvent[]): { trending: Set<string>; trendingRanks: Map<string, number>; conflictGroups: string[][] } {
  const now = Date.now();
  const recentCutoff   = now - TRENDING_RECENT_HOURS   * 3_600_000;
  const baselineCutoff = now - (TRENDING_RECENT_HOURS + TRENDING_BASELINE_HOURS) * 3_600_000;

  const recentScores:          Record<string, number>   = {};
  const baselineScores:        Record<string, number>   = {};
  const recentStoryCount:      Record<string, number>   = {};
  const recentSourcesPerCountry: Record<string, Set<string>> = {};

  // Per-country story dedup across the full window: prevents the same story
  // repeated across sources from inflating any country's score.
  const seenPerCountry = new Map<string, Set<string>>();
  // Collected in the same loop to avoid a second pass + date re-parsing
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

    // Source credibility × recency decay × cross-feed confirmation bonus
    const sourceWeight  = SOURCE_WEIGHTS[ev.source] ?? 1.0;
    const confirmBonus  = ev.confirmations ? 1 + 0.3 * Math.min(ev.confirmations - 1, 3) : 1;
    const weight = SEVERITY_WEIGHTS[ev.severity] * sourceWeight * recencyMultiplier(ev.time) * confirmBonus;
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
    const velocity = recentScore / Math.max(baselineRate, 1);
    eligible.push({ code, velocity });
  }

  if (eligible.length === 0) return { trending: new Set(), trendingRanks: new Map(), conflictGroups: [] };

  // Sort by velocity descending; keep all above the floor, cap at MAX_TRENDING.
  eligible.sort((a, b) => b.velocity - a.velocity);
  const trendingList = eligible
    .filter((e) => e.velocity >= VELOCITY_FLOOR)
    .slice(0, MAX_TRENDING);

  const trending = new Set(trendingList.map((e) => e.code));
  // 1-based rank map for the ordered trending list
  const trendingRanks = new Map(trendingList.map((e, i) => [e.code, i + 1]));

  // Record active conflict groups for informational use only — partners do NOT
  // inherit trending status automatically; they must qualify independently.
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

function aggregateCountries(events: NewsEvent[]): { countries: CountryNewsData[]; conflictGroups?: string[][] } {
  const recent = events.filter((e) => isWithinRetentionWindow(e.time));
  const { trending, trendingRanks, conflictGroups } = computeTrending(recent);
  const byCode: Record<string, NewsEvent[]> = {};
  for (const ev of recent) (byCode[ev.countryCode] ??= []).push(ev);
  const countries = Object.entries(byCode).map(([code, evs]) => {
    const info = getCountryInfoByCode(code);
    const isTrending = trending.has(code);
    return {
      code,
      name: evs[0].country,
      lat: info?.lat ?? 0,
      lng: info?.lng ?? 0,
      trending: isTrending,
      trendingRank: isTrending ? (trendingRanks.get(code) ?? undefined) : undefined,
      alertLevel: computeAlertLevel(evs, isTrending),
      // Pass the already-grouped per-country slice (evs) rather than the full
      // events array so the inner currentEvents loop in computeEscalationIndex
      // runs in O(K_country) instead of O(N_total × N_countries).
      escalationIndex: computeEscalationIndex(code, evs),
      // Cap events per country to prevent one conflict from dominating the feed
      events: evs
        .sort((a, b) => parseTimeMs(b.time) - parseTimeMs(a.time))
        .slice(0, MAX_EVENTS_PER_COUNTRY),
    };
  });
  return { countries, ...(conflictGroups.length > 0 ? { conflictGroups } : {}) };
}

// ── Mock data — shown when all RSS feeds are unavailable ─────────────────────
// Links are intentionally omitted from mock events: they are synthetic demo
// data and any hardcoded URL would point to a generic section page rather
// than the specific article, which is misleading.  Real RSS events always
// carry the article permalink from the feed's <link> element.
function generateMockData(): NewsMapData {
  const now = new Date();
  const h = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const raw: Omit<NewsEvent, "countryCode">[] = [
    // ── Iran × Israel: active conflict (fires conflict-group trending) ──────────
    { title: "Iran fires ballistic missiles toward Israeli-linked targets in latest escalation", source: "Al Jazeera", time: h(0.3), country: "Iran",          severity: "high",   category: "violent"    },
    { title: "IRGC deploys additional strike forces as regional tensions surge",                 source: "BBC",        time: h(0.6), country: "Iran",          severity: "high",   category: "escalation" },
    { title: "Mass protests turn violent outside Tehran parliament building",                    source: "DW",         time: h(0.9), country: "Iran",          severity: "high",   category: "violent"    },
    { title: "IDF launches retaliatory airstrikes on Iranian proxy positions in Syria",          source: "BBC",        time: h(0.4), country: "Israel",        severity: "high",   category: "violent"    },
    { title: "Israeli cabinet convenes emergency security meeting after missile barrage",        source: "Guardian",   time: h(0.8), country: "Israel",        severity: "high",   category: "escalation" },
    // ── Escalation demo events ────────────────────────────────────────────────
    { title: "North Korea launches ballistic missile over Sea of Japan in new provocation",     source: "BBC",        time: h(2),   country: "North Korea",  severity: "high",   category: "escalation" },
    { title: "Troops deployed to disputed border amid military buildup concerns",               source: "Al Jazeera", time: h(3),   country: "Pakistan",     severity: "medium", category: "escalation" },
    { title: "Coup attempt foiled as soldiers surrounding parliament are repelled",             source: "Guardian",   time: h(5),   country: "Ethiopia",     severity: "high",   category: "escalation" },
    { title: "State of emergency declared following nationwide civil unrest",                   source: "BBC",        time: h(6),   country: "Myanmar",      severity: "medium", category: "escalation" },
    // ── Ongoing conflict ──────────────────────────────────────────────────────
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
    { title: "Foreign minister meets counterpart amid tension over deal",  source: "BBC",        time: h(12),  country: "India",         severity: "medium", category: "diplomatic" },
    // ── Economic ─────────────────────────────────────────────────────────────
    { title: "Stock market crash wipes billions off exchange",             source: "BBC",        time: h(2),   country: "China",         severity: "high",   category: "economic" },
    { title: "Currency collapses amid economic meltdown",                  source: "Guardian",   time: h(6),   country: "Venezuela",     severity: "high",   category: "economic" },
    { title: "Banking crisis deepens as runs continue",                    source: "BBC",        time: h(8),   country: "Nigeria",       severity: "high",   category: "economic" },
    { title: "Trade embargo escalates trade war tensions",                 source: "Al Jazeera", time: h(3),   country: "Russia",        severity: "high",   category: "economic" },
    // ── Commodities ───────────────────────────────────────────────────────────
    { title: "Oil price crash triggers emergency OPEC meeting",            source: "BBC",        time: h(3),   country: "Saudi Arabia",  severity: "high",   category: "commodities"},
    { title: "Wheat prices surge after Black Sea grain deal suspended",    source: "Guardian",   time: h(7),   country: "Ukraine",       severity: "high",   category: "commodities"},
    // ── Cyber ─────────────────────────────────────────────────────────────────
    { title: "State-sponsored cyberattack takes down government systems",  source: "BBC",        time: h(3),   country: "Estonia",       severity: "high",   category: "cyber"      },
    { title: "Ransomware attack cripples hospital network across country",  source: "Guardian",   time: h(6),   country: "United Kingdom",severity: "high",   category: "cyber"      },
    // ── Health ────────────────────────────────────────────────────────────────
    { title: "WHO declares public health emergency over new outbreak",     source: "BBC",        time: h(4),   country: "Congo",         severity: "high",   category: "health"     },
    { title: "Ebola outbreak confirmed in border region, quarantine imposed",source:"Al Jazeera",time: h(8),   country: "Uganda",        severity: "high",   category: "health"     },
    // ── Environmental ─────────────────────────────────────────────────────────
    { title: "Catastrophic wildfires spread across southern region",       source: "BBC",        time: h(5),   country: "Greece",        severity: "high",   category: "environmental"},
    { title: "Major hurricane makes landfall causing widespread damage",   source: "Guardian",   time: h(10),  country: "Cuba",          severity: "high",   category: "environmental"},
    // ── Disaster ──────────────────────────────────────────────────────────────
    { title: "Major earthquake kills hundreds, rescue teams deployed",     source: "BBC",        time: h(6),   country: "Turkey",        severity: "high",   category: "disaster"   },
    { title: "Humanitarian crisis deepens as famine spreads",              source: "Al Jazeera", time: h(9),   country: "Sudan",         severity: "high",   category: "disaster"   },
    // ── Infrastructure ────────────────────────────────────────────────────────
    { title: "Pipeline explosion disrupts energy supply to region",        source: "BBC",        time: h(7),   country: "Poland",        severity: "high",   category: "infrastructure"},
    // ── Crime ─────────────────────────────────────────────────────────────────
    { title: "Drug cartel massacre leaves dozens dead in northern province",source: "Guardian",  time: h(6),   country: "Mexico",        severity: "high",   category: "crime"      },
    // ── Piracy ────────────────────────────────────────────────────────────────
    { title: "Commercial vessel seized by pirates in Gulf of Aden",        source: "BBC",        time: h(8),   country: "Somalia",       severity: "high",   category: "piracy"     },
    // ── Unrest / minor ────────────────────────────────────────────────────────
    { title: "Riot police clash with demonstrators downtown",              source: "Guardian",   time: h(7),   country: "France",        severity: "medium", category: "violent"  },
    { title: "Armed confrontation near disputed border",                   source: "BBC",        time: h(10),  country: "India",         severity: "medium", category: "violent"  },
    { title: "Kidnapping of journalists reported in conflict zone",        source: "Al Jazeera", time: h(12),  country: "Libya",         severity: "medium", category: "violent"  },
    { title: "Thousands march in peaceful climate demonstration",          source: "BBC",        time: h(4),   country: "Germany",       severity: "low",    category: "protest"  },
    { title: "Civil unrest follows disputed election results",             source: "Al Jazeera", time: h(11),  country: "Ethiopia",      severity: "low",    category: "minor"    },
    { title: "Evacuation ordered after minor earthquake",                  source: "DW",         time: h(15),  country: "Japan",         severity: "low",    category: "minor"    },
    { title: "Violent clashes erupt at border crossing",                   source: "Al Jazeera", time: h(16),  country: "Myanmar",       severity: "medium", category: "violent"  },
    // ── Extremism ─────────────────────────────────────────────────────────────
    { title: "Neo-nazi march through city centre draws counter-protests",  source: "Guardian",   time: h(5),   country: "Germany",       severity: "medium", category: "extremism" },
    { title: "Antisemitic attack on synagogue injures worshippers",        source: "BBC",        time: h(3),   country: "France",        severity: "high",   category: "extremism" },
    { title: "White supremacist rally triggers clashes with antifa groups",  source: "Guardian",   time: h(9),   country: "United States", severity: "medium", category: "extremism" },
    { title: "Far-right extremist group banned after hate march",          source: "BBC",        time: h(14),  country: "United Kingdom",severity: "medium", category: "extremism" },
  ];
  const events: NewsEvent[] = raw
    .map((e) => {
      const info = KEYWORD_MAP.get(e.country.toLowerCase());
      return info ? { ...e, countryCode: info.code } : null;
    })
    .filter((e): e is NewsEvent => e !== null);
  return { ...aggregateCountries(events), lastUpdated: new Date().toISOString(), usingMockData: true };
}

// ── Module-level response cache ──────────────────────────────────────────────
//
// Freshness chain — three layers keep the map live without hammering RSS feeds:
//   1. RSS re-fetch  — every CACHE_TTL_MS (10 min) the handler fetches all feeds
//   2. CDN cache     — Vercel/CDN caches the response for CDN_MAX_AGE_SECS (5 min)
//                      with stale-while-revalidate so the browser never waits for a
//                      cold fetch
//   3. Client poll   — useNewsMap re-requests /api/news-map every 15 min
//
// Events older than RETENTION_HOURS (48 h) are excluded by isWithinRetentionWindow
// in aggregateCountries(), so stale events never accumulate on the map.
// recencyMultiplier() further down-weights events as they age so fresh breaking
// news always dominates the alert-level and trending signals.
//
let _cache: NewsMapData | null = null;
let _cacheExpiresAt = 0;
/** How long the server-side handler caches the aggregated result before re-fetching RSS feeds */
const CACHE_TTL_MS = 600_000; // 10 minutes
/**
 * CDN / edge-cache max-age in seconds.  Derived from CACHE_TTL_MS so this stays
 * correct when the server TTL changes.  Set to half the server TTL so the CDN
 * refreshes frequently enough to serve fresh data without triggering unnecessary
 * RSS re-fetches (CACHE_TTL_MS / 1000 converts ms → s; / 2 halves it).
 */
const CDN_MAX_AGE_SECS = Math.floor(CACHE_TTL_MS / 1000 / 2); // 300 s = 5 min

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
    "User-Agent": NEWS_MAP_UA,
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
});

/**
 * Run `tasks` with at most `limit` concurrent executions.  Returns a
 * PromiseSettledResult array in input order — identical contract to
 * Promise.allSettled — but never has more than `limit` tasks in-flight at once.
 * Zero-dependency; safe for all GitHub Actions / Vercel runtimes.
 */
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const idx = next++;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]() };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Fetch and parse a single RSS feed source.
 * Extracted from the inline fetchAllEvents body so it can be wrapped cleanly
 * by withConcurrency and tested in isolation.
 */
async function fetchRSSSource(src: { name: string; url: string }): Promise<NewsEvent[]> {
  const feed = await parser.parseURL(src.url);
  const events: NewsEvent[] = [];
  for (const item of (feed.items ?? []).slice(0, ARTICLES_PER_FEED)) {
    if (!item.title) continue;
    // Strip boilerplate noise (cookie notices, subscribe prompts, nav artefacts)
    // from the snippet before classification and country scoring.
    const snippet = cleanSnippet(item.contentSnippet ?? item.content ?? "");
    const text = `${item.title} ${snippet}`;
    const cls = classifyEvent(text);
    if (!cls) continue;
    // Strip outlet names that contain country keywords from BOTH the title
    // and snippet before detection — e.g. "France 24" in a headline would
    // otherwise map the event to France instead of the real country.
    const cleanedTitle   = item.title.replace(OUTLET_NAME_RE, "");
    const cleanedSnippet = snippet.replace(OUTLET_NAME_RE, "");
    // Score all countries mentioned; pick the one with the highest score
    const scored = scoreCountries(cleanedTitle, cleanedSnippet);
    if (scored.length === 0) continue;
    const winner = scored[0];
    const confidence = calculateConfidence(winner.score, scored[1]?.score ?? 0);
    const country = winner.country;
    // isoDate is normalised by rss-parser; pubDate can be in any locale format
    const rawTime = item.isoDate ?? item.pubDate;
    const parsedDate = rawTime ? new Date(rawTime) : null;
    const validDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null;
    // Reject articles dated outside the retention window or too far in the future
    if (validDate) {
      const ageMs = Date.now() - validDate.getTime();
      if (ageMs > RETENTION_HOURS * 3_600_000 || ageMs < -3_600_000) continue;
    }
    const time = validDate ? validDate.toISOString() : new Date().toISOString();
    events.push({
      title: item.title,
      source: src.name,
      time,
      country: country.name,
      countryCode: country.code,
      severity: cls.severity,
      category: cls.category,
      link: item.link,
      score: winner.score,
      confidence,
    });
  }
  return events;
}

async function fetchAllEvents(): Promise<{ events: NewsEvent[]; feedStats: { succeeded: number; total: number } }> {
  // Build a flat task list across all three source types, then run with a
  // concurrency cap.  withConcurrency mirrors Promise.allSettled semantics so
  // a failed fetch is recorded as "rejected" without blocking the others, while
  // MAX_CONCURRENT_FETCHES prevents thundering-herd against rate-limited feeds.
  const tasks: Array<() => Promise<NewsEvent[]>> = [
    ...RSS_SOURCES.map((src) => () => fetchRSSSource(src)),
    ...TELEGRAM_CHANNELS.map((ch) => () => fetchTelegramChannel(ch)),
    ...REDDIT_JSON_SUBREDDITS.map((sub) => () => fetchRedditJSON(sub)),
  ];
  const allResults = await withConcurrency(tasks, MAX_CONCURRENT_FETCHES);

  // Merge results into story clusters for cross-feed confirmation tracking.
  // Each unique story (by country-scoped title prefix) is clustered; when
  // multiple sources report the same story the cluster's confirmation count
  // rises, which translates into a bonus in the trending computation.
  const storyClusters = new Map<string, { event: NewsEvent; sources: Set<string> }>();
  let succeeded = 0;
  const total = tasks.length;

  for (const r of allResults) {
    if (r.status !== "fulfilled") continue;
    succeeded++;
    for (const ev of r.value) {
      // Include country code in the dedup key: two stories from different
      // countries that share the same 40-char title prefix must not collide.
      const key = `${ev.countryCode}:${ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH)}`;
      const existing = storyClusters.get(key);
      if (!existing) {
        storyClusters.set(key, { event: ev, sources: new Set([ev.source]) });
      } else {
        existing.sources.add(ev.source);
        // Prefer the version with the highest attribution score,
        // but always retain the link from whichever event has one.
        if ((ev.score ?? 0) > (existing.event.score ?? 0)) {
          storyClusters.set(key, { event: { ...ev, link: ev.link ?? existing.event.link }, sources: existing.sources });
        } else if (!existing.event.link && ev.link) {
          // Lower-score event has a link the existing event lacks — preserve it.
          storyClusters.set(key, { event: { ...existing.event, link: ev.link }, sources: existing.sources });
        }
      }
    }
  }

  // Build final event list; attach confirmation count when > 1 distinct source
  const all: NewsEvent[] = [];
  for (const { event, sources } of storyClusters.values()) {
    all.push(sources.size > 1 ? { ...event, confirmations: sources.size } : event);
  }
  return { events: all, feedStats: { succeeded, total } };
}

// ── Telegram channel scraper ─────────────────────────────────────────────────
// t.me/s/{channel} is a public, no-login HTML page listing recent messages.
// We extract message text + timestamps via regex; no external HTML parser needed.

async function fetchTelegramChannel(src: { name: string; channel: string }): Promise<NewsEvent[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://t.me/s/${src.channel}`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": NEWS_MAP_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract (text, datetime, permalink) triples.  Telegram embeds message text
    // inside <div class="tgme_widget_message_text …">…</div>, a <time datetime="…">
    // element, and a permalink anchor <a class="tgme_widget_message_date" href="…">
    // inside the same message wrapper.  We match them in document order.
    // Note: the simple tag-stripping regex is adequate for Telegram's controlled
    // message HTML (no `>` inside attribute values in message content).
    const msgRe  = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    const timeRe = /<time\s+datetime="([^"]+)"/g;
    // The date-link anchor carries the canonical message permalink (https://t.me/…/id).
    // Match each opening <a> tag that has the tgme_widget_message_date class, then
    // extract its href separately — this handles any attribute order without a complex
    // two-branch alternation.
    const anchorRe = /<a\b[^>]*class="[^"]*tgme_widget_message_date[^"]*"[^>]*>/g;
    const hrefRe   = /href="([^"]+)"/;

    // Build the times and links arrays first (one entry per Telegram message,
    // unfiltered), then track each text's original message index so that
    // times[msgIdx] and msgLinks[msgIdx] always correspond to the same message.
    // Without this, filtering out short texts (< 20 chars) shifts all subsequent
    // indices, causing later stories to receive the wrong timestamp and link.
    const times: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = timeRe.exec(html)) !== null) times.push(m[1]);

    const msgLinks: string[] = [];
    while ((m = anchorRe.exec(html)) !== null) {
      const h = hrefRe.exec(m[0]);
      if (h) msgLinks.push(h[1]);
    }

    // Collect texts WITH their original message index before filtering.
    const validTexts: { text: string; msgIdx: number }[] = [];
    let msgIdx = 0;
    while ((m = msgRe.exec(html)) !== null) {
      // Strip HTML tags, collapse whitespace, then remove boilerplate noise
      const rawText = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const text = cleanSnippet(rawText);
      if (text.length > 20) validTexts.push({ text, msgIdx });
      msgIdx++;
    }
    // If the page yielded no messages, the channel is private, empty, or the
    // HTML structure changed — bail early so the failure is visible in feedStats.
    if (validTexts.length === 0) return [];

    const events: NewsEvent[] = [];
    const limit = Math.min(validTexts.length, ARTICLES_PER_FEED);
    for (let i = 0; i < limit; i++) {
      const { text, msgIdx: idx } = validTexts[i];
      const cls  = classifyEvent(text);
      if (!cls) continue;
      const cleanedText = text.replace(OUTLET_NAME_RE, "");
      const scored = scoreCountries(cleanedText, "");
      if (scored.length === 0) continue;
      const winner = scored[0];
      const confidence = calculateConfidence(winner.score, scored[1]?.score ?? 0);
      const country = winner.country;
      // Use the per-message timestamp via the original index; fall back to now.
      const rawTime    = times[idx];
      const parsedDate = rawTime ? new Date(rawTime) : null;
      const time = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();
      events.push({
        title: text.slice(0, 200),
        source: src.name,
        time,
        country: country.name,
        countryCode: country.code,
        severity: cls.severity,
        category: cls.category,
        link: msgLinks[idx],
        score: winner.score,
        confidence,
      });
    }
    return events;
  } finally {
    clearTimeout(timer);
  }
}

// ── Reddit JSON fetch ────────────────────────────────────────────────────────
// Reddit's /new.json endpoint requires no API key for public subreddits.
// We filter by minimum score to reduce low-quality posts, then apply the same
// classify/detect pipeline as RSS articles.

interface RedditPost {
  data: {
    title: string;
    url: string;
    selftext: string;
    created_utc: number;
    score: number;
  };
}

async function fetchRedditJSON(
  src: { name: string; sub: string; minScore: number }
): Promise<NewsEvent[]> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${src.sub}/new.json?limit=25`,
      {
        signal: ctrl.signal,
        headers: {
          "User-Agent": NEWS_MAP_UA,
          "Accept": "application/json",
        },
      }
    );
    if (!res.ok) return [];
    const json = await res.json() as { data?: { children?: RedditPost[] } };
    const posts = json?.data?.children ?? [];
    const events: NewsEvent[] = [];
    for (const post of posts.slice(0, ARTICLES_PER_FEED)) {
      const { title, url, selftext, created_utc, score } = post.data;
      if (!title || score < src.minScore) continue;
      const text = `${title} ${selftext ?? ""}`;
      const cls  = classifyEvent(text);
      if (!cls) continue;
      const cleanedTitle = title.replace(OUTLET_NAME_RE, "");
      const cleanedBody  = (selftext ?? "").replace(OUTLET_NAME_RE, "");
      // Score all countries; pick highest scorer
      const scored = scoreCountries(cleanedTitle, cleanedBody);
      if (scored.length === 0) continue;
      const winner = scored[0];
      const confidence = calculateConfidence(winner.score, scored[1]?.score ?? 0);
      const country = winner.country;
      events.push({
        title,
        source: src.name,
        time: new Date(created_utc * 1000).toISOString(),
        country: country.name,
        countryCode: country.code,
        severity: cls.severity,
        category: cls.category,
        link: url,
        score: winner.score,
        confidence,
      });
    }
    return events;
  } finally {
    clearTimeout(timer);
  }
}

// ── Vercel serverless handler ────────────────────────────────────────────────
export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Serve cached result if still fresh
  if (_cache && Date.now() < _cacheExpiresAt) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", `s-maxage=${CDN_MAX_AGE_SECS}, stale-while-revalidate=${CDN_MAX_AGE_SECS}`);
    res.end(JSON.stringify(_cache));
    return;
  }

  try {
    const { events, feedStats } = await fetchAllEvents();
    // Persist new events to the rolling 7-day escalation store
    if (events.length > 0) appendToEscalationStore(events);
    const data: NewsMapData =
      events.length > 0
        ? { ...aggregateCountries(events), lastUpdated: new Date().toISOString(), feedStats }
        : { ...generateMockData(), feedStats };

    _cache = data;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", `s-maxage=${CDN_MAX_AGE_SECS}, stale-while-revalidate=${CDN_MAX_AGE_SECS}`);
    res.end(JSON.stringify(data));
  } catch {
    // On unexpected error return mock data so the map is never blank
    const fallback = generateMockData();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60");
    res.end(JSON.stringify(fallback));
  }
}
