/**
 * /api/pulse — RSS news feed for the Pulse tile.
 *
 * Fetches the same RSS sources used by the Flashpoint news-map and classifies
 * each article using:
 *   1. The existing shared classifyEvent() function (covers all Flashpoint
 *      categories — no duplication).
 *   2. Additional pulse-only keyword matching for the categories that are
 *      unique to the Pulse feed (human_rights, migration, geopolitics, energy,
 *      crypto, technology, ai_ethics).
 *
 * Unlike the Flashpoint pipeline there is no country-scoring pass — Pulse is
 * a simple category-filtered news reader, not a geopolitical intelligence map.
 *
 * Response: PulseData JSON (see src/components/pulse/types.ts for the shape).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import Parser from "rss-parser";
import { classifyEvent, cleanSnippet, OUTLET_NAME_RE } from "./classifier.js";
import {
  RSS_SOURCES,
  ARTICLES_PER_FEED,
  FETCH_TIMEOUT,
  MAX_CONCURRENT_FETCHES,
  NEWS_MAP_UA,
} from "./sources.js";

// ── Pulse-only category types (mirrors src/components/pulse/types.ts) ────────
type PulseOnlyCategory =
  | "human_rights"
  | "migration"
  | "geopolitics"
  | "energy"
  | "crypto"
  | "technology"
  | "ai_ethics";

type PulseCategory =
  | "violent" | "terrorism" | "military" | "escalation" | "diplomatic"
  | "extremism" | "economic" | "commodities" | "cyber" | "health"
  | "environmental" | "disaster" | "infrastructure" | "crime" | "piracy"
  | "protest" | "minor"
  | PulseOnlyCategory;

interface PulseArticle {
  title: string;
  source: string;
  time: string;
  category: PulseCategory;
  link?: string;
  /** Best-effort thumbnail URL extracted from RSS media fields or enclosure */
  image?: string;
  /** Article author from dc:creator / <author> RSS tag */
  author?: string;
  /** Short article excerpt (plain text, ≤ 200 chars) */
  description?: string;
}

interface PulseData {
  articles: PulseArticle[];
  lastUpdated: string;
  feedStats?: { succeeded: number; total: number };
}

// ── Pulse-only keyword classification ────────────────────────────────────────
// Only keywords that fall outside the existing Flashpoint classifier are here.
// The existing classifyEvent() handles everything else.

function buildRe(keywords: string[]): RegExp {
  return new RegExp(
    keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  );
}

const RE_HUMAN_RIGHTS = buildRe([
  "human rights", "human rights violation", "human rights abuse",
  "war crimes", "war crime", "crimes against humanity",
  "torture", "arbitrary detention", "political prisoner",
  "freedom of speech", "freedom of press", "press freedom",
  "civil liberties", "discrimination", "racial discrimination",
  "gender equality", "women's rights", "lgbtq rights",
  "indigenous rights", "minority rights", "religious persecution",
  "amnesty international", "human rights watch",
  "extrajudicial killing", "forced disappearance",
  "child soldiers", "forced labour", "forced labor",
]);

const RE_MIGRATION = buildRe([
  "migrant", "migrants", "migration crisis", "illegal migration",
  "undocumented migrant", "undocumented migrants",
  "asylum seeker", "asylum seekers", "asylum claim",
  "refugee camp", "refugee crisis",
  "border crossing", "border crossings",
  "deportation", "deportations", "mass deportation",
  "immigration policy", "immigration reform",
  "smuggling network", "people smuggling",
  "internally displaced",
]);

const RE_GEOPOLITICS = buildRe([
  "geopolitics", "geopolitical", "sphere of influence",
  "power dynamics", "power vacuum", "regional power",
  "strategic competition", "great power", "great powers",
  "nato expansion", "nato enlargement",
  "belt and road", "quad alliance",
  "indo-pacific", "transatlantic", "g7", "g20 summit",
  "bilateral relations", "multilateral", "global governance",
  "international order", "world order",
  "strategic rivalry", "strategic interests",
]);

const RE_ENERGY = buildRe([
  "renewable energy", "solar energy", "wind energy", "wind power",
  "solar power", "clean energy", "green energy",
  "fossil fuel", "fossil fuels", "coal phase-out", "coal phase out",
  "natural gas", "lng terminal",
  "nuclear power", "nuclear energy", "nuclear plant",
  "energy transition", "energy security",
  "carbon emission", "carbon emissions", "net zero",
  "climate finance", "green deal", "inflation reduction act",
  "electric vehicle", "ev battery", "battery storage",
  "hydrogen fuel", "energy storage",
]);

const RE_CRYPTO = buildRe([
  "bitcoin", "ethereum", "cryptocurrency", "cryptocurrencies",
  "blockchain", "defi", "decentralized finance",
  "crypto market", "crypto exchange", "crypto regulation",
  "stablecoin", "cbdc", "central bank digital currency",
  "nft", "non-fungible token", "web3",
  "crypto crash", "crypto rally", "crypto fraud",
  "sec crypto", "crypto sec",
  "binance", "coinbase", "ftx", "solana",
]);

const RE_TECHNOLOGY = buildRe([
  "artificial intelligence", "machine learning", "large language model",
  "chatgpt", "gemini ai", "openai", "anthropic",
  "space exploration", "nasa", "spacex", "esa space",
  "rocket launch", "satellite launch", "moon mission",
  "quantum computing", "quantum computer",
  "breakthrough technology", "tech innovation",
  "semiconductor", "chip shortage", "silicon valley",
  "robotics", "autonomous vehicle", "self-driving",
  "biotechnology", "gene editing", "crispr",
  "5g network", "6g", "internet of things",
]);

const RE_AI_ETHICS = buildRe([
  "ai regulation", "ai ethics", "ai governance",
  "artificial intelligence regulation", "ai act",
  "ai safety", "ai risk", "existential risk",
  "deepfake", "deep fake", "synthetic media",
  "algorithmic bias", "algorithmic discrimination",
  "facial recognition ban", "surveillance technology",
  "data privacy", "data protection", "gdpr",
  "digital rights", "platform accountability",
  "social media regulation", "content moderation",
  "misinformation", "disinformation", "fake news regulation",
]);

/**
 * Extends the shared classifyEvent() with pulse-only categories.
 * Pulse-only categories are tested AFTER the shared classifier so that
 * e.g. "crypto exchange hacked" → cyber (Flashpoint) rather than crypto,
 * keeping Flashpoint categories authoritative.
 */
function classifyPulse(text: string): PulseCategory | null {
  // First try the shared Flashpoint classifier
  const shared = classifyEvent(text);
  if (shared) return shared.category as PulseCategory;

  // Then try pulse-only categories
  const lower = text.toLowerCase();
  if (RE_HUMAN_RIGHTS.test(lower)) return "human_rights";
  if (RE_MIGRATION.test(lower))    return "migration";
  if (RE_GEOPOLITICS.test(lower))  return "geopolitics";
  if (RE_ENERGY.test(lower))       return "energy";
  if (RE_TECHNOLOGY.test(lower))   return "technology";
  if (RE_AI_ETHICS.test(lower))    return "ai_ethics";
  if (RE_CRYPTO.test(lower))       return "crypto";

  return null;
}

// ── Concurrent fetch helper ───────────────────────────────────────────────────
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    if (index >= tasks.length) return;
    const current = index++;
    try {
      results[current] = { status: "fulfilled", value: await tasks[current]() };
    } catch (err) {
      results[current] = { status: "rejected", reason: err };
    }
    await runNext();
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    runNext(),
  );
  await Promise.all(workers);
  return results;
}

// ── Image extraction ──────────────────────────────────────────────────────────
/**
 * Extract the best-available thumbnail URL from a parsed RSS item.
 * Priority order (most reliable → least reliable):
 *   1. media:thumbnail (widely supported — BBC, Guardian, Al Jazeera, etc.)
 *   2. media:content with medium="image" or type starting with "image/"
 *   3. Standard RSS enclosure typed as an image
 *   4. First <img src> found inside the description/content HTML
 */

/** Pull url string from a media:thumbnail or media:content element */
function mediaUrl(element: unknown): string | undefined {
  if (!element) return undefined;
  if (typeof element === "string" && element.startsWith("http")) return element;
  const el = element as Record<string, unknown>;
  if (el.$ && typeof (el.$ as Record<string, string>).url === "string")
    return (el.$ as Record<string, string>).url;
  return undefined;
}

function extractImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: Record<string, any>,
): string | undefined {
  // 1. media:thumbnail — can be an object with $ attribute map, or a string
  const thumb = item["mediaThumbnail"];
  if (thumb) {
    const url = Array.isArray(thumb) ? mediaUrl(thumb[0]) : mediaUrl(thumb);
    if (url) return url;
  }

  // 2. media:content
  const mc = item["mediaContent"];
  if (mc) {
    const candidates: unknown[] = Array.isArray(mc) ? mc : [mc];
    // Prefer explicitly image-typed entry
    for (const c of candidates) {
      const el = c as Record<string, Record<string, string>>;
      const medium: string = el?.$?.medium ?? "";
      const mtype: string = el?.$?.type ?? "";
      if (medium === "image" || mtype.startsWith("image/")) {
        const url = mediaUrl(c);
        if (url) return url;
      }
    }
    // Accept any media:content URL as fallback
    for (const c of candidates) {
      const url = mediaUrl(c);
      if (url) return url;
    }
  }

  // 3. Standard RSS enclosure
  const enc = item["enclosure"];
  if (enc?.url && (enc.type ?? "").startsWith("image/")) return enc.url as string;

  // 4. First <img src> in description or content HTML
  const html = item["content"] ?? item["summary"] ?? "";
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html as string);
  if (imgMatch?.[1] && imgMatch[1].startsWith("http")) return imgMatch[1];

  return undefined;
}

// ── RSS fetch ─────────────────────────────────────────────────────────────────
const DEDUP_KEY_LENGTH = 48;

async function fetchFeedArticles(
  parser: Parser,
  source: { name: string; url: string },
): Promise<PulseArticle[]> {
  const feed = await parser.parseURL(source.url);
  const articles: PulseArticle[] = [];
  for (const item of (feed.items ?? []).slice(0, ARTICLES_PER_FEED)) {
    const rawTitle = item.title ?? "";
    const titleClean = rawTitle.replace(OUTLET_NAME_RE, "").trim();
    const snippet = cleanSnippet(
      [item.contentSnippet, item.content, item.summary]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500),
    );
    const classifyText = `${titleClean} ${snippet}`;
    const category = classifyPulse(classifyText);
    if (!category) continue;

    const pubDate = item.isoDate ?? item.pubDate ?? new Date().toISOString();
    const image = extractImage(item as Record<string, unknown>);

    // Author: rss-parser surfaces dc:creator as item.creator; fall back to item.author
    const rawAuthor: string =
      (item as Record<string, string>).creator ??
      (item as Record<string, string>).author ??
      "";
    const author = rawAuthor.trim() || undefined;

    // Description: clean text snippet, capped at MAX_DESCRIPTION_LENGTH chars
    const MAX_RAW_SNIPPET = 600;
    const MAX_DESCRIPTION_LENGTH = 200;
    const rawSnippet = cleanSnippet(
      (item.contentSnippet ?? item.summary ?? "").slice(0, MAX_RAW_SNIPPET),
    ).trim();
    const description = rawSnippet.length > 0
      ? rawSnippet.slice(0, MAX_DESCRIPTION_LENGTH) + (rawSnippet.length > MAX_DESCRIPTION_LENGTH ? "…" : "")
      : undefined;

    articles.push({
      title: rawTitle.trim() || "(no title)",
      source: source.name,
      time: pubDate,
      category,
      link: item.link ?? undefined,
      ...(image ? { image } : {}),
      ...(author ? { author } : {}),
      ...(description ? { description } : {}),
    });
  }
  return articles;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parser = new Parser({
    timeout: FETCH_TIMEOUT,
    headers: { "User-Agent": NEWS_MAP_UA },
    customFields: {
      item: [
        ["media:thumbnail", "mediaThumbnail"],
        ["media:content",   "mediaContent"],
      ],
    },
  });

  const tasks = RSS_SOURCES.map(
    (src) => () => fetchFeedArticles(parser, src),
  );

  const settled = await withConcurrencyLimit(tasks, MAX_CONCURRENT_FETCHES);

  let succeeded = 0;
  const allArticles: PulseArticle[] = [];
  const seen = new Set<string>();

  for (const result of settled) {
    if (result.status === "fulfilled") {
      succeeded++;
      for (const article of result.value) {
        const key = article.title.slice(0, DEDUP_KEY_LENGTH).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allArticles.push(article);
      }
    }
  }

  // Sort newest-first
  allArticles.sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );

  // Cap total articles to avoid excessive payload
  const MAX_ARTICLES = 200;
  const articles = allArticles.slice(0, MAX_ARTICLES);

  const payload: PulseData = {
    articles,
    lastUpdated: new Date().toISOString(),
    feedStats: { succeeded, total: RSS_SOURCES.length },
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=120");
  res.end(JSON.stringify(payload));
}
