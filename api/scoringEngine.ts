/**
 * Deterministic scoring engine for RSS → country detection.
 *
 * No AI, no NLP libraries — pure array and index logic.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CountryEntry {
  code: string;
  name: string;
  aliases: string[];
  adjectives: string[];
  lat: number;
  lng: number;
}

export interface ScoredCountry {
  country: CountryEntry;
  score: number;
}

export interface ArticleInput {
  id?: string;
  title: string;
  body?: string;
  url?: string;
}

export interface ScoredEvent {
  id: string;
  title: string;
  country: string;
  lat: number;
  lng: number;
  score: number;
  confidence: number;
  type: string;
  url: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Event keywords used for proximity scoring and event-type classification */
export const EVENT_KEYWORDS = [
  "bombing", "strike", "attack", "explosion", "missile",
  "drone", "protest", "airstrike",
];

/** Context words near a country mention indicating attribution rather than location */
const NEGATIVE_CONTEXT = [
  "said", "supports", "condemns", "warned", "reacted", "calls", "backed",
  "denounces", "criticises", "criticizes", "urges", "responds",
  "accuses", "rebuts", "refutes", "rejects", "dismisses",
];

/** Article type markers that reduce the final score by 20 % */
const EDITORIAL_MARKERS = ["analysis", "opinion", "editorial"];

// ── Country data ──────────────────────────────────────────────────────────────

let _countries: CountryEntry[] | null = null;

function loadCountries(): CountryEntry[] {
  if (_countries) return _countries;
  try {
    // __dirname is not available in ESM — derive it from import.meta.url when
    // running under Node 18+. Fall back to process.cwd() for older runtimes.
    let dir: string;
    try {
      dir = dirname(fileURLToPath(import.meta.url));
    } catch {
      dir = process.cwd();
    }
    const raw = readFileSync(join(dir, "countries.json"), "utf-8");
    _countries = JSON.parse(raw) as CountryEntry[];
  } catch {
    _countries = [];
  }
  return _countries;
}

// ── Alias index ───────────────────────────────────────────────────────────────

interface AliasEntry {
  tokens: string[];
  country: CountryEntry;
  /** Whether this entry was derived from the country name, an alias, or an adjective */
  type: "name" | "alias" | "adjective";
}

let _aliasIndex: AliasEntry[] | null = null;

function getAliasIndex(): AliasEntry[] {
  if (_aliasIndex) return _aliasIndex;
  const index: AliasEntry[] = [];
  for (const country of loadCountries()) {
    index.push({ tokens: normalizeText(country.name), country, type: "name" });
    for (const alias of country.aliases) {
      index.push({ tokens: normalizeText(alias), country, type: "alias" });
    }
    for (const adj of country.adjectives) {
      // Map adjective forms to the base country
      index.push({ tokens: normalizeText(adj), country, type: "adjective" });
    }
  }
  // Sort longest-first so multi-word aliases are tried before single-word ones
  index.sort((a, b) => b.tokens.length - a.tokens.length);
  _aliasIndex = index;
  return _aliasIndex;
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Normalise article text: lowercase, remove punctuation, split into word tokens.
 */
export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Find all token-index positions where any alias/adjective of `country`
 * appears in `tokens`.  Handles multi-word aliases via consecutive-token
 * matching.  Returns an array of start-indices (one per match).
 */
export function findCountryMentions(
  tokens: string[],
  country: CountryEntry
): number[] {
  const positions: number[] = [];
  const aliasIndex = getAliasIndex();

  // Collect only entries for this country, sorted longest-first (already sorted)
  const entries = aliasIndex.filter((e) => e.country.code === country.code);

  const matched = new Set<number>();
  for (const entry of entries) {
    const len = entry.tokens.length;
    outer: for (let i = 0; i <= tokens.length - len; i++) {
      if (matched.has(i)) continue;
      for (let j = 0; j < len; j++) {
        if (tokens[i + j] !== entry.tokens[j]) continue outer;
      }
      positions.push(i);
      // Mark all positions covered by this match to avoid double-counting
      for (let k = 0; k < len; k++) matched.add(i + k);
    }
  }

  return positions.sort((a, b) => a - b);
}

/**
 * For each mention position return the minimum token distance to the nearest
 * event keyword in `tokens`.  Returns Infinity if no event keyword exists.
 */
export function calculateKeywordDistances(
  tokens: string[],
  mentionPositions: number[]
): number[] {
  const kwPositions: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (EVENT_KEYWORDS.includes(tokens[i])) kwPositions.push(i);
  }

  return mentionPositions.map((pos) => {
    if (kwPositions.length === 0) return Infinity;
    return Math.min(...kwPositions.map((kp) => Math.abs(pos - kp)));
  });
}

/**
 * Returns true if any city/region-level alias (type="alias") for `country`
 * appears in `tokens`.  Used to award a geographic-specificity bonus when an
 * article names a specific location rather than just the country.
 */
function hasSpecificGeoMatch(tokens: string[], country: CountryEntry): boolean {
  const entries = getAliasIndex().filter(
    (e) => e.country.code === country.code && e.type === "alias"
  );
  for (const entry of entries) {
    const len = entry.tokens.length;
    outer: for (let i = 0; i <= tokens.length - len; i++) {
      for (let j = 0; j < len; j++) {
        if (tokens[i + j] !== entry.tokens[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

/**
 * Score all countries mentioned in `title` and `body`.
 *
 * Scoring rules:
 *   +6  country appears in headline (title tokens)
 *   +4  within 2 words of an event keyword
 *   +3  within 5 words
 *   +2  within 8 words
 *   +1  per extra body mention (max +3)
 *   +2  first mention in first 30 % of the article
 *   −4  near a negative-context word AND no event keyword within 6 words
 *   ×0.8 if article contains editorial markers (applied at the end)
 *
 * Returns array sorted descending by score; empty if nothing was found.
 */
export function scoreCountries(title: string, body: string): ScoredCountry[] {
  const titleTokens = normalizeText(title);
  const bodyTokens  = normalizeText(body);
  const allTokens   = [...titleTokens, ...bodyTokens];
  const totalLen    = allTokens.length;
  const titleLen    = titleTokens.length;
  const tokenSet    = new Set(allTokens);

  const isEditorial = EDITORIAL_MARKERS.some((m) => tokenSet.has(m));

  // Negative-context token set (single-token check)
  const negSet = new Set(NEGATIVE_CONTEXT);

  const scores = new Map<string, { country: CountryEntry; score: number }>();

  for (const country of loadCountries()) {
    const positions = findCountryMentions(allTokens, country);
    if (positions.length === 0) continue;

    let score = 0;

    // ── Headline bonus ───────────────────────────────────────────────────────
    const inHeadline = positions.some((p) => p < titleLen);
    if (inHeadline) score += 6;

    // ── Proximity-based scoring ──────────────────────────────────────────────
    const distances = calculateKeywordDistances(allTokens, positions);
    let extraBodyMentions = 0;

    for (let i = 0; i < positions.length; i++) {
      const pos  = positions[i];
      const dist = distances[i];
      const isInTitle = pos < titleLen;

      // Proximity bonus — accumulates per mention so multiple co-located
      // references (e.g. headline + body) raise the score further.
      if (dist <= 2)      score += 4;
      else if (dist <= 5) score += 3;
      else if (dist <= 8) score += 2;

      // Extra body-mention bonus (first mention is the "main" one)
      if (!isInTitle && i > 0) {
        if (extraBodyMentions < 3) { score += 1; extraBodyMentions++; }
      }

      // ── Negative-context check ───────────────────────────────────────────
      // Look for a negative-context word within 5 tokens of this mention
      const windowStart = Math.max(0, pos - 5);
      const windowEnd   = Math.min(totalLen - 1, pos + 5);
      let nearNegative  = false;
      for (let w = windowStart; w <= windowEnd; w++) {
        if (negSet.has(allTokens[w])) { nearNegative = true; break; }
      }
      if (nearNegative) {
        // Only penalise when no event keyword is within 6 tokens of this mention
        const noEventNearby = dist > 6;
        if (noEventNearby) score -= 4;
      }
    }

    // ── First-30%-of-article bonus ───────────────────────────────────────────
    if (totalLen > 0 && positions[0] / totalLen < 0.3) score += 2;

    // ── Geographic specificity boost ─────────────────────────────────────────
    // City/region-level mentions are more specific than country name alone.
    if (hasSpecificGeoMatch(allTokens, country)) score += 1;

    // ── Editorial penalty ────────────────────────────────────────────────────
    if (isEditorial) score = Math.floor(score * 0.8);

    if (score > 0) {
      scores.set(country.code, { country, score });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score);
}

/**
 * Confidence formula: (winner_score − second_score) / (winner_score + 1)
 * Clamped between 0 and 1.
 */
export function calculateConfidence(
  winnerScore: number,
  secondScore: number
): number {
  if (winnerScore <= 0) return 0;
  const raw = (winnerScore - secondScore) / (winnerScore + 1);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Determine event type from the first matching event keyword in `tokens`.
 * Returns the keyword string, or "unknown" if none match.
 */
export function classifyEventType(tokens: string[]): string {
  for (const token of tokens) {
    if (EVENT_KEYWORDS.includes(token)) return token;
  }
  return "unknown";
}

/**
 * Assemble the final scored-event object from an article and its scored countries.
 * Returns null if no country scored high enough to be selected.
 */
export function buildEventObject(
  article: ArticleInput,
  scored: ScoredCountry[]
): ScoredEvent | null {
  if (scored.length === 0) return null;

  const winner     = scored[0];
  const secondScore = scored[1]?.score ?? 0;
  const confidence  = calculateConfidence(winner.score, secondScore);
  const tokens      = normalizeText(`${article.title} ${article.body ?? ""}`);
  const type        = classifyEventType(tokens);
  const id          = article.id ?? `${Date.now()}-${winner.country.code}`;

  return {
    id,
    title:      article.title,
    country:    winner.country.name,
    lat:        winner.country.lat,
    lng:        winner.country.lng,
    score:      winner.score,
    confidence,
    type,
    url:        article.url ?? "",
  };
}

/**
 * Look up a country entry by ISO-3166 code (case-insensitive).
 */
export function getCountryByCode(code: string): CountryEntry | undefined {
  return loadCountries().find((c) => c.code === code.toUpperCase());
}
