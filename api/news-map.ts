import type { IncomingMessage, ServerResponse } from "node:http";
import Parser from "rss-parser";
import { scoreCountries, calculateConfidence, getCountryByCode } from "./scoringEngine";

// ── Types (mirror src/components/news-map/types.ts) ─────────────────────────
type EventSeverity = "high" | "medium" | "low";
type EventCategory = "violent" | "minor" | "economic" | "extremism" | "escalation";
type AlertLevel    = "critical" | "high" | "medium" | "watch";

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
  // ── Near-realtime conflict monitoring (no API key required) ────────────────
  // GDELT monitors millions of global news articles and surfaces conflict events
  // within hours. No rate limits. timespan=6h aligns with our baseline window.
  { name: "GDELT", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(attack+OR+airstrike+OR+bombing+OR+killed+OR+conflict+OR+war+OR+explosion)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=6h" },
  // A second GDELT feed scoped to the last 1 hour ensures the trending window
  // always has enough recent articles even if the broader baseline feed is sparse.
  { name: "GDELT Breaking", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(attack+OR+airstrike+OR+bombing+OR+killed+OR+explosion+OR+shooting+OR+casualties)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=1h" },
  // ── Community / social signal (no API key required) ────────────────────────
  // Reddit r/worldnews and r/geopolitics users post breaking news within minutes
  // of events occurring — often faster than traditional RSS feeds.
  // Note: X/Twitter would be ideal but requires a paid API subscription.
  { name: "Reddit WorldNews",   url: "https://www.reddit.com/r/worldnews/new/.rss" },
  { name: "Reddit Geopolitics", url: "https://www.reddit.com/r/geopolitics/new/.rss" },
];

const ARTICLES_PER_FEED = 20;

/** Shared fetch timeout (ms) applied to all non-RSS sources */
const FETCH_TIMEOUT = 10_000;

/** Shared User-Agent used in the RSS parser, Telegram scraper, and Reddit JSON fetcher */
const NEWS_MAP_UA = "Mozilla/5.0 (compatible; GL4NCE-NewsMap/1.0; +https://github.com/o-goodall/GL4NCE)";

/** Outlet name patterns that contain country keywords and must be stripped from
 *  both titles and content snippets before country detection to prevent false
 *  attribution.  "France 24" → contains "france"; all other current sources are safe. */
const OUTLET_NAME_RE = /\bfrance\s*24\b/gi;

// ── Telegram public channels ─────────────────────────────────────────────────
// t.me/s/{channel} returns a public HTML page — no login or API key required.
// These outlets post breaking news to Telegram within minutes of events, often
// ahead of their own RSS feeds.  HTML scraping is used since Telegram has no
// public RSS endpoint for channels.
//
// Selected for English-language reliability and geopolitical breadth:
//   alarabiya_en  – Al Arabiya English (Middle East / Asia focus)
//   trtworld      – TRT World (broad international coverage)
//   bbcnews       – BBC News (global)
//   reutersagency – Reuters (newswire, fast turnaround)
const TELEGRAM_CHANNELS = [
  { name: "Al Arabiya (Telegram)", channel: "alarabiya_en" },
  { name: "TRT World (Telegram)",  channel: "trtworld" },
  { name: "BBC News (Telegram)",   channel: "bbcnews" },
  { name: "Reuters (Telegram)",    channel: "reutersagency" },
];

// ── Reddit JSON subreddits ───────────────────────────────────────────────────
// Reddit's public /new.json endpoint requires no API key.  We target subreddits
// not already covered by the RSS feeds above, and filter by score ≥ 20 so only
// community-upvoted (more likely accurate) posts are included.
//
// r/worldnews and r/geopolitics are already in RSS_SOURCES; these extend coverage:
//   UkrainianConflict – focused conflict subreddit, high signal-to-noise
//   MiddleEastNews    – regional specialist
//   BreakingNews      – multi-topic, fast but noisier → higher score threshold
const REDDIT_JSON_SUBREDDITS = [
  { name: "Reddit UkrainianConflict", sub: "UkrainianConflict", minScore: 20 },
  { name: "Reddit MiddleEastNews",    sub: "MiddleEastNews",    minScore: 20 },
  { name: "Reddit BreakingNews",      sub: "BreakingNews",      minScore: 50 },
];

// ── Classification keyword lists ─────────────────────────────────────────────
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
  // Humanitarian / disaster terms — surfaces ReliefWeb and UN News articles
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
/** All countries with velocity ≥ this absolute floor are co-trending */
const VELOCITY_FLOOR = 1.2;
/** Hard cap on concurrent trending countries */
const MAX_TRENDING = 5;
/** Maximum events retained per country in the response (prevents one country flooding the output) */
const MAX_EVENTS_PER_COUNTRY = 10;
/** Rolling window for the 7-day escalation index (ms) */
const ESCALATION_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Source credibility weights by outlet name.
 * Tier 1 (1.5): wire services / public broadcasters with editorial standards
 * Tier 2 (1.2): major international broadcasters
 * Tier 3 (1.0): specialist / regional outlets, humanitarian bodies
 * Tier 4 (0.8): algorithmic aggregators (GDELT)
 * Tier 5 (0.6/0.5): community / social sources
 */
const SOURCE_WEIGHTS: Record<string, number> = {
  "AP News":                  1.5,
  "BBC":                      1.5,
  "BBC News (Telegram)":      1.3,
  "Reuters (Telegram)":       1.5,
  "Guardian":                 1.2,
  "Al Jazeera":               1.2,
  "Al Arabiya (Telegram)":    1.1,
  "CNN":                      1.2,
  "DW":                       1.2,
  "France24":                 1.1,
  "Sky News":                 1.1,
  "RFE/RL":                   1.0,
  "Euronews":                 1.0,
  "CNA":                      1.0,
  "Africanews":               1.0,
  "TRT World (Telegram)":     0.9,
  "ReliefWeb":                1.0,
  "UN News":                  1.0,
  "GDELT":                    0.8,
  "GDELT Breaking":           0.8,
  "Reddit WorldNews":         0.6,
  "Reddit Geopolitics":       0.6,
  "Reddit UkrainianConflict": 0.6,
  "Reddit MiddleEastNews":    0.6,
  "Reddit BreakingNews":      0.5,
};

/**
 * Known active conflicts / wars.  When any trending country is a member of one
 * of these groups AND the partner country(ies) also have recent events, all
 * active members are surfaced together.
 */
const CONFLICT_GROUPS: readonly (readonly string[])[] = [
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

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (matchesAny(lower, HIGH_ECONOMIC))     return { severity: "high",   category: "economic"    };
  if (matchesAny(lower, HIGH_EXTREMISM))    return { severity: "high",   category: "extremism"   };
  if (matchesAny(lower, MEDIUM_EXTREMISM))  return { severity: "medium", category: "extremism"   };
  // Pre-conflict escalation signals — checked BEFORE generic violence so that
  // "killed during coup attempt" maps to escalation, not just violent.
  if (matchesAny(lower, HIGH_ESCALATION))   return { severity: "high",   category: "escalation"  };
  if (matchesAny(lower, MEDIUM_ESCALATION)) return { severity: "medium", category: "escalation"  };
  if (matchesAny(lower, HIGH_VIOLENT))      return { severity: "high",   category: "violent"     };
  if (matchesAny(lower, MEDIUM_VIOLENT))    return { severity: "medium", category: "violent"     };
  if (matchesAny(lower, LOW_MINOR))         return { severity: "low",    category: "minor"       };
  return null;
}

/** Look up country info from the scoring-engine database by ISO code */
function getCountryInfoByCode(code: string) {
  return getCountryByCode(code) ?? KEYWORD_MAP.get(code.toLowerCase());
}

function isWithinRetentionWindow(isoTime: string): boolean {
  return Date.now() - new Date(isoTime).getTime() <= RETENTION_HOURS * 3_600_000;
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
  const ageH = (Date.now() - new Date(isoTime).getTime()) / 3_600_000;
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

let _escalationStore: NewsEvent[] = [];
/** Pre-computed key set for O(1) dedup checks in appendToEscalationStore */
let _escalationKeys: Set<string> = new Set();

/** Append fresh events to the 7-day store, deduplicating on title prefix. */
function appendToEscalationStore(newEvents: NewsEvent[]): void {
  const cutoff = Date.now() - ESCALATION_WINDOW_MS;
  for (const ev of newEvents) {
    const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    if (!_escalationKeys.has(key)) {
      _escalationKeys.add(key);
      _escalationStore.push(ev);
    }
  }
  // Prune stale events; rebuild key cache only when pruning occurred
  const pruned = _escalationStore.filter((e) => new Date(e.time).getTime() >= cutoff);
  if (pruned.length < _escalationStore.length) {
    _escalationStore = pruned;
    _escalationKeys = new Set(
      _escalationStore.map((e) => e.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH))
    );
  }
}

/**
 * Compute a weighted activity score for `countryCode` over the 7-day window.
 * Combines the persistent store with the current-request events for accuracy.
 * Higher values indicate more sustained or escalating activity.
 */
function computeEscalationIndex(countryCode: string, currentEvents: NewsEvent[]): number {
  const cutoff = Date.now() - ESCALATION_WINDOW_MS;
  const seen = new Set<string>();
  let score = 0;

  // Process store and current events separately to avoid array spread allocation
  for (const ev of _escalationStore) {
    if (ev.countryCode !== countryCode) continue;
    if (new Date(ev.time).getTime() < cutoff) continue;
    const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
    if (seen.has(key)) continue;
    seen.add(key);
    score += SEVERITY_WEIGHTS[ev.severity] * CATEGORY_SCORE_MULTIPLIERS[ev.category] * recencyMultiplier(ev.time);
  }
  for (const ev of currentEvents) {
    if (ev.countryCode !== countryCode) continue;
    if (new Date(ev.time).getTime() < cutoff) continue;
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
  const recent = events.filter((e) => new Date(e.time).getTime() >= cutoff24h);
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
 * MAX_TRENDING.  Conflict-group partners of any trending country are also
 * surfaced when they have recent events.
 */
function computeTrending(events: NewsEvent[]): { trending: Set<string>; conflictGroups: string[][] } {
  const now = Date.now();
  const recentCutoff   = now - TRENDING_RECENT_HOURS   * 3_600_000;
  const baselineCutoff = now - (TRENDING_RECENT_HOURS + TRENDING_BASELINE_HOURS) * 3_600_000;

  const recentScores:   Record<string, number> = {};
  const baselineScores: Record<string, number> = {};

  // Per-country story dedup across the full window: prevents the same story
  // repeated across sources from inflating any country's score.
  const seenPerCountry = new Map<string, Set<string>>();

  for (const ev of events) {
    const evTime = new Date(ev.time).getTime();
    if (evTime < baselineCutoff) continue;

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
      recentScores[ev.countryCode]   = (recentScores[ev.countryCode]   ?? 0) + weight;
    } else {
      baselineScores[ev.countryCode] = (baselineScores[ev.countryCode] ?? 0) + weight;
    }
  }

  // Compute velocity for each country that cleared the score threshold.
  const eligible: { code: string; velocity: number }[] = [];
  for (const [code, recentScore] of Object.entries(recentScores)) {
    if (recentScore < TRENDING_THRESHOLD) continue;
    const baselineRate = (baselineScores[code] ?? 0) / TRENDING_BASELINE_HOURS;
    const velocity = recentScore / Math.max(baselineRate, 1);
    eligible.push({ code, velocity });
  }

  if (eligible.length === 0) return { trending: new Set(), conflictGroups: [] };

  // Sort by velocity descending; keep all above the floor, cap at MAX_TRENDING.
  eligible.sort((a, b) => b.velocity - a.velocity);
  const trendingList = eligible
    .filter((e) => e.velocity >= VELOCITY_FLOOR)
    .slice(0, MAX_TRENDING);

  const trending = new Set(trendingList.map((e) => e.code));

  // Set of all country codes that have any event in the full baseline window.
  const codesWithEvents = new Set(
    events
      .filter((e) => new Date(e.time).getTime() >= baselineCutoff)
      .map((e) => e.countryCode)
  );

  // For each trending country, surface its active conflict group partners.
  // seenGroups prevents duplicate group entries when multiple members of the
  // same group are trending simultaneously.
  const seenGroups = new Set<string>();
  const activeConflictGroups: string[][] = [];
  for (const { code: tCode } of trendingList) {
    for (const group of CONFLICT_GROUPS) {
      if (!group.includes(tCode)) continue;
      const groupKey = [...group].sort().join("-");
      if (seenGroups.has(groupKey)) continue;
      const activeMembers = (group as readonly string[]).filter((c) => codesWithEvents.has(c));
      if (activeMembers.length >= 2) {
        activeMembers.forEach((c) => trending.add(c));
        activeConflictGroups.push(activeMembers);
        seenGroups.add(groupKey);
      }
    }
  }

  return { trending, conflictGroups: activeConflictGroups };
}

function aggregateCountries(events: NewsEvent[]): { countries: CountryNewsData[]; conflictGroups?: string[][] } {
  const recent = events.filter((e) => isWithinRetentionWindow(e.time));
  const { trending, conflictGroups } = computeTrending(recent);
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
      alertLevel: computeAlertLevel(evs, isTrending),
      escalationIndex: computeEscalationIndex(code, events),
      // Cap events per country to prevent one conflict from dominating the feed
      events: evs
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, MAX_EVENTS_PER_COUNTRY),
    };
  });
  return { countries, ...(conflictGroups.length > 0 ? { conflictGroups } : {}) };
}

// ── Mock data — shown when all RSS feeds are unavailable ─────────────────────
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
    { title: "Explosion near government building kills several",           source: "Al Jazeera", time: h(1),   country: "Iraq",          severity: "high",   category: "violent"   },
    { title: "Airstrike targets militant positions in northern region",    source: "BBC",        time: h(2),   country: "Syria",         severity: "high",   category: "violent"   },
    { title: "Missile strike reported on port city",                       source: "Al Jazeera", time: h(1.5), country: "Yemen",         severity: "high",   category: "violent"   },
    { title: "Casualties reported after drone strike",                     source: "BBC",        time: h(3),   country: "Ukraine",       severity: "high",   category: "violent"   },
    { title: "Bombing attack on market leaves dozens dead",                source: "Guardian",   time: h(4),   country: "Afghanistan",   severity: "high",   category: "violent"   },
    // ── Economic ─────────────────────────────────────────────────────────────
    { title: "Stock market crash wipes billions off exchange",             source: "BBC",        time: h(2),   country: "China",         severity: "high",   category: "economic"  },
    { title: "Currency collapses amid economic meltdown",                  source: "Guardian",   time: h(6),   country: "Venezuela",     severity: "high",   category: "economic"  },
    { title: "Banking crisis deepens as runs continue",                    source: "BBC",        time: h(8),   country: "Nigeria",       severity: "high",   category: "economic"  },
    { title: "Trade embargo escalates trade war tensions",                 source: "Al Jazeera", time: h(3),   country: "Russia",        severity: "high",   category: "economic"  },
    // ── Unrest / minor ────────────────────────────────────────────────────────
    { title: "Riot police clash with demonstrators downtown",              source: "Guardian",   time: h(7),   country: "France",        severity: "medium", category: "violent"   },
    { title: "Armed confrontation near disputed border",                   source: "BBC",        time: h(10),  country: "India",         severity: "medium", category: "violent"   },
    { title: "Kidnapping of journalists reported in conflict zone",        source: "Al Jazeera", time: h(12),  country: "Libya",         severity: "medium", category: "violent"   },
    { title: "Thousands march in peaceful climate demonstration",          source: "BBC",        time: h(4),   country: "Germany",       severity: "low",    category: "minor"     },
    { title: "Civil unrest follows disputed election results",             source: "Al Jazeera", time: h(11),  country: "Ethiopia",      severity: "low",    category: "minor"     },
    { title: "Evacuation ordered after minor earthquake",                  source: "DW",         time: h(15),  country: "Japan",         severity: "low",    category: "minor"     },
    { title: "Food shortage worsens amid supply chain collapse",           source: "Al Jazeera", time: h(6),   country: "Sudan",         severity: "high",   category: "economic"  },
    { title: "Mass casualties in coordinated terrorist attack",            source: "BBC",        time: h(2),   country: "Somalia",       severity: "high",   category: "violent"   },
    { title: "Violent clashes erupt at border crossing",                   source: "Al Jazeera", time: h(16),  country: "Myanmar",       severity: "medium", category: "violent"   },
    // ── Extremism ─────────────────────────────────────────────────────────────
    { title: "Neo-nazi march through city centre draws counter-protests",  source: "Guardian",   time: h(5),   country: "Germany",       severity: "medium", category: "extremism" },
    { title: "Antisemitic attack on synagogue injures worshippers",        source: "BBC",        time: h(3),   country: "France",        severity: "high",   category: "extremism" },
    { title: "White supremacist rally triggers clashes with antifa",       source: "Guardian",   time: h(9),   country: "United States", severity: "medium", category: "extremism" },
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

// ── Module-level response cache (10-minute TTL) ──────────────────────────────
let _cache: NewsMapData | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

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

async function fetchAllEvents(): Promise<{ events: NewsEvent[]; feedStats: { succeeded: number; total: number } }> {
  // Run RSS feeds, Telegram channels, and Reddit JSON subreddits concurrently.
  // Each group uses Promise.allSettled so a failed source never blocks others.
  const [rssResults, telegramResults, redditResults] = await Promise.all([
    Promise.allSettled(RSS_SOURCES.map(async (src) => {
      const feed = await parser.parseURL(src.url);
      const events: NewsEvent[] = [];
      for (const item of (feed.items ?? []).slice(0, ARTICLES_PER_FEED)) {
        if (!item.title || !item.link) continue;
        const snippet = item.contentSnippet ?? item.content ?? "";
        const text = `${item.title} ${snippet}`;
        const cls = classifyEvent(text);
        if (!cls) continue;
        // Try title-only detection first: prevents an outlet's own country
        // (appearing in the snippet/byline) from overriding the country named
        // in the headline (e.g. Indian paper reporting on Bolivia).
        // Strip outlet names that contain country keywords from BOTH the title
        // and snippet before detection — e.g. "France 24" in a headline like
        // "France 24 reporter killed in Gaza" would otherwise map the event to
        // France instead of the real country.
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
          score: winner.score,
          confidence,
        });
      }
      return events;
    })),
    Promise.allSettled(TELEGRAM_CHANNELS.map(fetchTelegramChannel)),
    Promise.allSettled(REDDIT_JSON_SUBREDDITS.map(fetchRedditJSON)),
  ]);

  // Merge results into story clusters for cross-feed confirmation tracking.
  // Each unique story (by title prefix) is clustered; when multiple sources
  // report the same story the cluster's confirmation count rises, which
  // translates into a bonus in the trending computation.
  const storyClusters = new Map<string, { event: NewsEvent; sources: Set<string> }>();
  let succeeded = 0;
  const total = RSS_SOURCES.length + TELEGRAM_CHANNELS.length + REDDIT_JSON_SUBREDDITS.length;

  for (const r of [...rssResults, ...telegramResults, ...redditResults]) {
    if (r.status !== "fulfilled") continue;
    succeeded++;
    for (const ev of r.value) {
      const key = ev.title.toLowerCase().slice(0, DEDUP_TITLE_LENGTH);
      const existing = storyClusters.get(key);
      if (!existing) {
        storyClusters.set(key, { event: ev, sources: new Set([ev.source]) });
      } else {
        existing.sources.add(ev.source);
        // Prefer the version with the highest attribution score
        if ((ev.score ?? 0) > (existing.event.score ?? 0)) {
          storyClusters.set(key, { event: ev, sources: existing.sources });
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

    // Extract (text, datetime) pairs.  Telegram embeds message text inside
    // <div class="tgme_widget_message_text …">…</div> and a <time datetime="…">
    // element inside the same message wrapper.  We match them in document order.
    // Note: the simple tag-stripping regex is adequate for Telegram's controlled
    // message HTML (no `>` inside attribute values in message content).
    const msgRe  = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    const timeRe = /<time\s+datetime="([^"]+)"/g;

    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = msgRe.exec(html)) !== null) {
      // Strip HTML tags; collapse whitespace
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 20) texts.push(text);
    }
    // If the page yielded no messages, the channel is private, empty, or the
    // HTML structure changed — bail early so the failure is visible in feedStats.
    if (texts.length === 0) return [];

    const times: string[] = [];
    while ((m = timeRe.exec(html)) !== null) times.push(m[1]);

    const events: NewsEvent[] = [];
    const limit = Math.min(texts.length, ARTICLES_PER_FEED);
    for (let i = 0; i < limit; i++) {
      const text = texts[i];
      const cls  = classifyEvent(text);
      if (!cls) continue;
      const cleanedText = text.replace(OUTLET_NAME_RE, "");
      const scored = scoreCountries(cleanedText, "");
      if (scored.length === 0) continue;
      const winner = scored[0];
      const confidence = calculateConfidence(winner.score, scored[1]?.score ?? 0);
      const country = winner.country;
      // Use the per-message timestamp when available; fall back to now if the
      // times array is shorter than the texts array (shouldn't happen with valid
      // Telegram HTML but defensive here so we never assign a wrong timestamp).
      const rawTime    = times[i];
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
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
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
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    res.end(JSON.stringify(data));
  } catch {
    // On unexpected error return mock data so the map is never blank
    const fallback = generateMockData();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60");
    res.end(JSON.stringify(fallback));
  }
}
