/**
 * Feed source configuration — RSS feeds, Telegram channels, Reddit subreddits,
 * source credibility weights, and known conflict groups.
 *
 * Keeping configuration separate from logic means adding, removing, or tuning
 * a source only requires changes to this file, with zero risk of breaking the
 * classification or aggregation pipeline.
 */

export const ARTICLES_PER_FEED = 20;

/** Shared fetch timeout (ms) applied to all non-RSS sources */
export const FETCH_TIMEOUT = 10_000;

/**
 * Maximum number of concurrent HTTP fetch operations across all source types
 * (RSS, Telegram, Reddit).  Capping concurrency prevents thundering-herd
 * behaviour against rate-limited endpoints and bounds memory usage during
 * feed parsing as the source list grows beyond ~30 entries.
 */
export const MAX_CONCURRENT_FETCHES = 12;

/** Shared User-Agent used in the RSS parser, Telegram scraper, and Reddit JSON fetcher */
export const NEWS_MAP_UA =
  "Mozilla/5.0 (compatible; GL4NCE-NewsMap/1.0; +https://github.com/o-goodall/GL4NCE)";

// ── RSS feeds ─────────────────────────────────────────────────────────────────
// All feeds are fetched concurrently via Promise.allSettled — a single slow or
// unavailable feed fails fast (10 s timeout) without blocking the others.
//
// Excluded from this list:
//   Reuters       – removed public RSS in 2020; feeds.reuters.com always 404s
//   FT            – full paywall; RSS returns no usable article text
//   Telesur       – Venezuelan state outlet; RSS endpoint unreliable
//   Euronews/FBN  – Feedburner variant deprecated; direct feed already present
export const RSS_SOURCES = [
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
  { name: "GDELT",         url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(attack+OR+airstrike+OR+bombing+OR+killed+OR+conflict+OR+war+OR+explosion)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=6h" },
  // A second GDELT feed scoped to the last 1 hour ensures the trending window
  // always has enough recent articles even if the broader baseline feed is sparse.
  { name: "GDELT Breaking", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(attack+OR+airstrike+OR+bombing+OR+killed+OR+explosion+OR+shooting+OR+casualties)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=1h" },
  // ── Community / social signal (no API key required) ────────────────────────
  // Reddit r/worldnews and r/geopolitics users post breaking news within minutes
  // of events occurring — often faster than traditional RSS feeds.
  // Note: X/Twitter would be ideal but requires a paid API subscription.
  { name: "Reddit WorldNews",   url: "https://www.reddit.com/r/worldnews/new/.rss" },
  { name: "Reddit Geopolitics", url: "https://www.reddit.com/r/geopolitics/new/.rss" },
  // ── GDELT targeted event queries (structured, machine-readable) ────────────
  // Augment the general GDELT feeds with focused queries for specific event
  // types the Flashpoints pipeline needs to surface reliably.  Each query
  // targets a specific intelligence requirement; the timespan is tuned to the
  // typical publication cadence for that topic.
  { name: "GDELT Protests",  url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(protest+OR+unrest+OR+riot+OR+uprising+OR+demonstration+OR+civil+disobedience)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=1h" },
  { name: "GDELT Conflict",  url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(armed+conflict+OR+insurgent+OR+rebel+offensive+OR+militant+attack+OR+guerrilla+OR+civil+war)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=6h" },
  { name: "GDELT Military",  url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(military+exercise+OR+troop+deployment+OR+naval+exercise+OR+carrier+strike+group+OR+defense+procurement+OR+arms+deal)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=25&sort=DateDesc&timespan=6h" },
  { name: "GDELT Missiles",  url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(missile+test+OR+missile+launch+OR+ballistic+missile+OR+hypersonic+weapon+OR+nuclear+test+OR+weapons+test)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=15&sort=DateDesc&timespan=6h" },
  { name: "GDELT NATO",      url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(nato+posture+OR+nato+readiness+OR+nato+deployment+OR+nato+exercise+OR+nato+statement)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=15&sort=DateDesc&timespan=6h" },
  { name: "GDELT Carriers",  url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(carrier+strike+group+OR+carrier+battle+group+OR+fleet+deployment+OR+naval+task+force+OR+amphibious+ready+group)%20sourcelang:english&mode=ArtList&format=RSS&maxrecords=15&sort=DateDesc&timespan=24h" },
  // ── Defense / military OSINT (no registration required) ─────────────────────
  // USNI News (US Naval Institute) publishes the weekly Fleet Tracker and
  // covers carrier group movements, naval exercises, and defense procurement.
  { name: "USNI News", url: "https://news.usni.org/feed" },
];

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
export const TELEGRAM_CHANNELS = [
  { name: "Al Arabiya (Telegram)", channel: "alarabiya_en" },
  { name: "TRT World (Telegram)",  channel: "trtworld" },
  { name: "BBC News (Telegram)",   channel: "bbcnews" },
  { name: "Reuters (Telegram)",    channel: "reutersagency" },
];

// ── Reddit JSON subreddits ───────────────────────────────────────────────────
// Reddit's public /new.json endpoint requires no API key for public subreddits.
// We filter by minimum score to reduce low-quality posts, then apply the same
// classify/detect pipeline as RSS articles.
//
// r/worldnews and r/geopolitics are already in RSS_SOURCES; these extend coverage:
//   UkrainianConflict – focused conflict subreddit, high signal-to-noise
//   MiddleEastNews    – regional specialist
//   BreakingNews      – multi-topic, fast but noisier → higher score threshold
export const REDDIT_JSON_SUBREDDITS = [
  { name: "Reddit UkrainianConflict", sub: "UkrainianConflict", minScore: 20 },
  { name: "Reddit MiddleEastNews",    sub: "MiddleEastNews",    minScore: 20 },
  { name: "Reddit BreakingNews",      sub: "BreakingNews",      minScore: 50 },
];

/**
 * Source credibility weights by outlet name.
 * Tier 1 (1.5): wire services / public broadcasters with editorial standards
 * Tier 2 (1.2): major international broadcasters
 * Tier 3 (1.0): specialist / regional outlets, humanitarian bodies
 * Tier 4 (0.8): algorithmic aggregators (GDELT)
 * Tier 5 (0.6/0.5): community / social sources
 */
export const SOURCE_WEIGHTS: Record<string, number> = {
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
  "GDELT Protests":           0.8,
  "GDELT Conflict":           0.8,
  "GDELT Military":           0.8,
  "GDELT Missiles":           0.8,
  "GDELT NATO":               0.8,
  "GDELT Carriers":           0.8,
  "USNI News":                1.0,
};

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
