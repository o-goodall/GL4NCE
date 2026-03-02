import { useState, useMemo, memo } from "react";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Colour palette for category badges ────────────────────────────────────────
const CATEGORY_BADGE_COLOUR: Record<PulseCategory, string> = {
  // Flashpoint-inherited
  violent:        "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-300",
  terrorism:      "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-200",
  military:       "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  escalation:     "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  diplomatic:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  extremism:      "bg-pink-100   text-pink-700   dark:bg-pink-900/30   dark:text-pink-300",
  economic:       "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-300",
  commodities:    "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-200",
  cyber:          "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  health:         "bg-teal-100   text-teal-700   dark:bg-teal-900/30   dark:text-teal-300",
  environmental:  "bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-300",
  disaster:       "bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-300",
  infrastructure: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  crime:          "bg-rose-100   text-rose-700   dark:bg-rose-900/30   dark:text-rose-300",
  piracy:         "bg-cyan-100   text-cyan-700   dark:bg-cyan-900/30   dark:text-cyan-300",
  protest:        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
  minor:          "bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400",
  // Pulse-only
  human_rights:   "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  migration:      "bg-sky-100    text-sky-700    dark:bg-sky-900/30    dark:text-sky-300",
  geopolitics:    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  energy:         "bg-lime-100   text-lime-700   dark:bg-lime-900/30   dark:text-lime-300",
  crypto:         "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  technology:     "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
  ai_ethics:      "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── ArticleCard ────────────────────────────────────────────────────────────────
const ArticleCard = memo(function ArticleCard({ article }: { article: PulseArticle }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-gray-100 last:border-0 dark:border-gray-800">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm font-medium text-gray-800 dark:text-white/90 leading-snug line-clamp-2">
          {article.title}
        </p>
        {article.link && (
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
            aria-label={`Read: ${article.title}`}
          >
            Read ↗
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400 dark:text-gray-500">
        <span className="truncate">{article.source}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{relativeTime(article.time)}</span>
        <span aria-hidden="true">·</span>
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium uppercase tracking-wide ${CATEGORY_BADGE_COLOUR[article.category]}`}
        >
          {PULSE_CATEGORY_LABEL[article.category]}
        </span>
      </div>
    </div>
  );
});

// ── PulseFeed ──────────────────────────────────────────────────────────────────
const ALL_GROUP = "All";
const ARTICLES_PER_PAGE = 20;

export default function PulseFeed() {
  const { data, loading, error, refresh } = usePulse();
  const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUP);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Reset pagination when filter changes
  const handleGroupChange = (group: string) => {
    setActiveGroup(group);
    setShowAll(false);
  };
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setShowAll(false);
  };

  // Derive the set of categories for the active group
  const groupCategories = useMemo<PulseCategory[] | null>(() => {
    if (activeGroup === ALL_GROUP) return null;
    return (
      PULSE_CATEGORY_GROUPS.find((g) => g.label === activeGroup)?.categories ??
      null
    );
  }, [activeGroup]);

  // Filtered + searched articles
  const filtered = useMemo(() => {
    if (!data) return [];
    let articles = data.articles;
    if (groupCategories) {
      const catSet = new Set<PulseCategory>(groupCategories);
      articles = articles.filter((a) => catSet.has(a.category));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q) ||
          PULSE_CATEGORY_LABEL[a.category].toLowerCase().includes(q),
      );
    }
    return articles;
  }, [data, groupCategories, search]);

  const displayed = showAll ? filtered : filtered.slice(0, ARTICLES_PER_PAGE);
  const hasMore = !showAll && filtered.length > ARTICLES_PER_PAGE;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
            General News / Context
          </p>
        </div>
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              General News / Context
            </p>
          </div>
          <button
            onClick={refresh}
            className="text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
            aria-label="Retry loading pulse feed"
          >
            Retry ↺
          </button>
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
          Feed unavailable — live Pulse data requires the Vercel runtime.
        </p>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-6 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
            General News / Context
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data?.feedStats && (
            <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
              {data.feedStats.succeeded}/{data.feedStats.total} feeds
            </span>
          )}
          <button
            onClick={refresh}
            className="text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
            aria-label="Refresh pulse feed"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Category group tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => handleGroupChange(ALL_GROUP)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            activeGroup === ALL_GROUP
              ? "bg-brand-500 text-white dark:bg-brand-600"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          }`}
        >
          All
        </button>
        {PULSE_CATEGORY_GROUPS.map((group) => (
          <button
            key={group.label}
            onClick={() => handleGroupChange(group.label)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              activeGroup === group.label
                ? "bg-brand-500 text-white dark:bg-brand-600"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          value={search}
          onChange={handleSearch}
          placeholder="Search articles…"
          aria-label="Search pulse articles"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-brand-500"
        />
      </div>

      {/* Article list */}
      {displayed.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">
          {search.trim()
            ? `No articles match "${search}"`
            : "No articles in this category yet."}
        </p>
      ) : (
        <>
          <div>
            {displayed.map((article, idx) => (
              <ArticleCard key={`${article.source}-${article.time}-${article.title.slice(0, 24)}-${idx}`} article={article} />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-3 w-full text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors py-1"
            >
              Show {filtered.length - ARTICLES_PER_PAGE} more ↓
            </button>
          )}
        </>
      )}

      {/* Footer: article count + last updated */}
      {data && (
        <p className="mt-4 text-center text-[10px] text-gray-300 dark:text-gray-700">
          {filtered.length} article{filtered.length !== 1 ? "s" : ""} · updated{" "}
          {relativeTime(data.lastUpdated)} ago
        </p>
      )}
    </div>
  );
}
