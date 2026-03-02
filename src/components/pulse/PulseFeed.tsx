import { useState, useMemo, memo, useCallback } from "react";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  PULSE_GROUP_SHORT_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── ArticleRow — compact list row, mirrors Triggers' MarketCard compact ───────
const ArticleRow = memo(function ArticleRow({ article }: { article: PulseArticle }) {
  const Tag = article.link ? "a" : "div";
  const linkProps = article.link
    ? { href: article.link, target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <Tag
      {...linkProps}
      className="group block rounded-xl border px-3 py-2 transition-colors border-gray-100 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40 dark:border-gray-800 dark:bg-white/[0.02] dark:hover:border-brand-700/50 dark:hover:bg-brand-900/10"
      title={article.title}
    >
      <p className="text-xs font-medium text-gray-800 dark:text-white/90 line-clamp-2 mb-1.5 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
        {article.title}
      </p>
      <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
        <span className="shrink-0 inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
          {PULSE_CATEGORY_LABEL[article.category]}
        </span>
        <span className="shrink-0 tabular-nums">{relativeTime(article.time)}</span>
        <span className="truncate">{article.source}</span>
        {article.link && (
          <span className="ml-auto shrink-0 text-brand-500 dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">
            ↗
          </span>
        )}
      </div>
    </Tag>
  );
});

// ── SkeletonRow ───────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02] px-3 py-2 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-1.5" />
      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700 mb-1.5" />
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="h-2.5 w-8 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-2.5 w-24 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

// ── PulseFeed ──────────────────────────────────────────────────────────────────
const ALL_GROUP = "All";
/** Max visible height of the article list before scrolling (mirrors Triggers). */
const LIST_MAX_HEIGHT = 480;
/** Shared outer container classes — kept consistent across all render states. */
const OUTER_CLS = "rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6";

export default function PulseFeed() {
  const { data, loading, error, refresh } = usePulse();
  const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUP);
  const [search, setSearch] = useState("");

  const handleGroupChange = useCallback((group: string) => {
    setActiveGroup(group);
  }, []);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={OUTER_CLS}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className={OUTER_CLS}>
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
    <div className={OUTER_CLS}>
      {/* Header — mirrors Triggers header structure */}
      <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
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

      {/* Article list — scrollable single column, mirrors Triggers DesktopList */}
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">
          {search.trim() ? `No articles match "${search}"` : "No articles in this category yet."}
        </p>
      ) : (
        <div
          className="flex flex-col gap-2 overflow-y-auto pr-0.5"
          style={{ maxHeight: `${LIST_MAX_HEIGHT}px`, scrollbarWidth: "thin" }}
          aria-label="News articles"
        >
          {filtered.map((article, idx) => (
            <ArticleRow
              key={`${article.source}-${article.time}-${article.title.slice(0, 24)}-${idx}`}
              article={article}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {data && filtered.length > 0 && (
        <p className="mt-3 text-center text-[10px] text-gray-300 dark:text-gray-700">
          {filtered.length} articles
          {data.lastUpdated && ` · updated ${relativeTime(data.lastUpdated)} ago`}
        </p>
      )}
    </div>
  );
}

