import { useState, useMemo, memo, useCallback } from "react";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  PULSE_GROUP_SHORT_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Category gradients — dark-to-lighter header backgrounds ──────────────────
// Uses standard Tailwind color scale (dark shades so white text is legible).
const CATEGORY_GRADIENT: Record<PulseCategory, string> = {
  violent:        "from-red-900    to-red-700",
  terrorism:      "from-rose-900   to-red-900",
  military:       "from-orange-900 to-orange-700",
  escalation:     "from-orange-900 to-amber-800",
  diplomatic:     "from-purple-900 to-purple-700",
  extremism:      "from-pink-900   to-pink-700",
  economic:       "from-blue-900   to-blue-700",
  commodities:    "from-blue-900   to-sky-800",
  cyber:          "from-indigo-900 to-indigo-700",
  health:         "from-teal-900   to-teal-700",
  environmental:  "from-green-900  to-green-700",
  disaster:       "from-amber-900  to-amber-700",
  infrastructure: "from-yellow-900 to-yellow-700",
  crime:          "from-rose-900   to-rose-700",
  piracy:         "from-cyan-900   to-cyan-700",
  protest:        "from-orange-900 to-yellow-900",
  minor:          "from-gray-800   to-gray-700",
  human_rights:   "from-fuchsia-900 to-fuchsia-700",
  migration:      "from-sky-900    to-sky-700",
  geopolitics:    "from-violet-900 to-violet-700",
  energy:         "from-lime-900   to-lime-700",
  crypto:         "from-yellow-900 to-amber-900",
  technology:     "from-indigo-900 to-blue-900",
  ai_ethics:      "from-purple-900 to-purple-700",
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
  const gradient = CATEGORY_GRADIENT[article.category];
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
      {/* Gradient header — contains category, time, title, description, Read More */}
      <div className={`flex flex-col gap-2 p-4 bg-gradient-to-br ${gradient} min-h-[9rem]`}>
        {/* Top row: category badge + time */}
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {PULSE_CATEGORY_LABEL[article.category]}
          </span>
          <span className="text-[10px] text-white/60 tabular-nums shrink-0">
            {relativeTime(article.time)}
          </span>
        </div>
        {/* Title */}
        <h3 className="text-base font-bold text-white leading-snug line-clamp-3 flex-1" title={article.title}>
          {article.title}
        </h3>
        {/* Description */}
        {article.description && (
          <p className="text-sm text-white/75 leading-relaxed line-clamp-2">
            {article.description}
          </p>
        )}
        {/* Read More button */}
        {article.link && (
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 self-start inline-flex items-center rounded-lg border border-white/50 bg-transparent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15"
            aria-label={`Read: ${article.title}`}
          >
            Read More ↗
          </a>
        )}
      </div>
      {/* Meta footer — author / source */}
      <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {article.author && (
            <span className="font-medium text-gray-500 dark:text-gray-400">{article.author} · </span>
          )}
          {article.source}
        </p>
      </div>
    </div>
  );
});

// ── Loading skeleton card ──────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse">
      <div className="p-4 bg-gray-800/60 min-h-[9rem] flex flex-col gap-2">
        <div className="flex justify-between gap-2">
          <div className="h-4 bg-white/10 rounded-full w-20" />
          <div className="h-3 bg-white/10 rounded w-8" />
        </div>
        <div className="h-4 bg-white/10 rounded w-full mt-1" />
        <div className="h-4 bg-white/10 rounded w-4/5" />
        <div className="h-3 bg-white/10 rounded w-full mt-1" />
        <div className="h-3 bg-white/10 rounded w-3/4" />
        <div className="mt-1 h-7 bg-white/10 rounded-lg w-24" />
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-2/5" />
      </div>
    </div>
  );
}

// ── PulseFeed ──────────────────────────────────────────────────────────────────
const ALL_GROUP = "All";
const PAGE_SIZE = 12;

export default function PulseFeed() {
  const { data, loading, error, refresh } = usePulse();
  const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUP);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const resetPagination = useCallback(() => setPage(1), []);

  const handleGroupChange = useCallback((group: string) => {
    setActiveGroup(group);
    resetPagination();
  }, [resetPagination]);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    resetPagination();
  }, [resetPagination]);

  const groupCategories = useMemo<PulseCategory[] | null>(() => {
    if (activeGroup === ALL_GROUP) return null;
    return PULSE_CATEGORY_GROUPS.find((g) => g.label === activeGroup)?.categories ?? null;
  }, [activeGroup]);

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

  const totalShown = Math.min(page * PAGE_SIZE, filtered.length);
  const displayed = filtered.slice(0, totalShown);
  const hasMore = totalShown < filtered.length;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
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

      {/* Category tabs — horizontal scroll on mobile */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => handleGroupChange(ALL_GROUP)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeGroup === group.label
                ? "bg-brand-500 text-white dark:bg-brand-600"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            <span className="sm:hidden">{PULSE_GROUP_SHORT_LABEL[group.label] ?? group.label}</span>
            <span className="hidden sm:inline">{group.label}</span>
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
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-brand-500"
        />
      </div>

      {/* Article grid — 1 col mobile, 2 col sm, 3 col xl */}
      {displayed.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          {search.trim() ? `No articles match "${search}"` : "No articles in this category yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {displayed.map((article, idx) => (
              <ArticleCard
                key={`${article.source}-${article.time}-${article.title.slice(0, 24)}-${idx}`}
                article={article}
              />
            ))}
          </div>

          {/* Show more */}
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="mt-4 w-full text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors py-1"
            >
              Show {Math.min(PAGE_SIZE, filtered.length - totalShown)} more ↓
            </button>
          )}
        </>
      )}

      {/* Footer */}
      {data && (
        <p className="mt-4 text-center text-[10px] text-gray-300 dark:text-gray-700">
          Showing {totalShown} of {filtered.length} articles
          {data.lastUpdated && ` · updated ${relativeTime(data.lastUpdated)} ago`}
        </p>
      )}
    </div>
  );
}

