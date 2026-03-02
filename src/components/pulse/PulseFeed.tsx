import { useState, useMemo, memo, useCallback } from "react";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  PULSE_GROUP_SHORT_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Category styles — dot colour + text label colour ──────────────────────────
// Inherits the same palette used by LiveEventFeed for flashpoint categories;
// extended with Pulse-only additions.
const CATEGORY_COLOUR: Record<PulseCategory, { dot: string; label: string }> = {
  violent:        { dot: "bg-error-500",   label: "text-error-600   dark:text-error-400"   },
  terrorism:      { dot: "bg-error-600",   label: "text-error-700   dark:text-error-300"   },
  military:       { dot: "bg-orange-600",  label: "text-orange-700  dark:text-orange-300"  },
  escalation:     { dot: "bg-orange-500",  label: "text-orange-600  dark:text-orange-400"  },
  diplomatic:     { dot: "bg-purple-600",  label: "text-purple-600  dark:text-purple-400"  },
  extremism:      { dot: "bg-brand-600",   label: "text-brand-600   dark:text-brand-300"   },
  economic:       { dot: "bg-blue-600",    label: "text-blue-600    dark:text-blue-400"    },
  commodities:    { dot: "bg-blue-700",    label: "text-blue-700    dark:text-blue-300"    },
  cyber:          { dot: "bg-indigo-600",  label: "text-indigo-600  dark:text-indigo-400"  },
  health:         { dot: "bg-teal-600",    label: "text-teal-600    dark:text-teal-400"    },
  environmental:  { dot: "bg-green-600",   label: "text-green-600   dark:text-green-400"   },
  disaster:       { dot: "bg-amber-600",   label: "text-amber-600   dark:text-amber-400"   },
  infrastructure: { dot: "bg-yellow-600",  label: "text-yellow-600  dark:text-yellow-400"  },
  crime:          { dot: "bg-rose-600",    label: "text-rose-600    dark:text-rose-400"    },
  piracy:         { dot: "bg-cyan-600",    label: "text-cyan-600    dark:text-cyan-400"    },
  protest:        { dot: "bg-warning-500", label: "text-warning-600 dark:text-warning-400" },
  minor:          { dot: "bg-gray-400",    label: "text-gray-500    dark:text-gray-400"    },
  human_rights:   { dot: "bg-fuchsia-600", label: "text-fuchsia-600 dark:text-fuchsia-400" },
  migration:      { dot: "bg-sky-600",     label: "text-sky-600     dark:text-sky-400"     },
  geopolitics:    { dot: "bg-violet-600",  label: "text-violet-600  dark:text-violet-400"  },
  energy:         { dot: "bg-lime-600",    label: "text-lime-600    dark:text-lime-400"    },
  crypto:         { dot: "bg-yellow-500",  label: "text-yellow-600  dark:text-yellow-400"  },
  technology:     { dot: "bg-indigo-500",  label: "text-indigo-500  dark:text-indigo-400"  },
  ai_ethics:      { dot: "bg-purple-500",  label: "text-purple-500  dark:text-purple-400"  },
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

// ── ArticleRow ─────────────────────────────────────────────────────────────────
const ArticleRow = memo(function ArticleRow({ article }: { article: PulseArticle }) {
  const colour = CATEGORY_COLOUR[article.category];
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 dark:border-gray-800">
      {/* Category dot */}
      <span
        className={`mt-1.5 shrink-0 h-2 w-2 rounded-full ${colour.dot}`}
        aria-label={PULSE_CATEGORY_LABEL[article.category]}
      />
      <div className="flex-1 min-w-0">
        {/* Headline */}
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90 leading-snug line-clamp-2">
          {article.title}
        </p>
        {/* Description */}
        {article.description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
            {article.description}
          </p>
        )}
        {/* Meta row — matches LiveEventFeed FeedRow style */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[10px] text-gray-400 dark:text-gray-500">
          {article.author && (
            <>
              <span className="font-medium truncate max-w-[14ch]">{article.author}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="truncate">{article.source}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums shrink-0">{relativeTime(article.time)}</span>
          <span aria-hidden="true">·</span>
          <span className={`shrink-0 font-medium uppercase ${colour.label}`}>
            {PULSE_CATEGORY_LABEL[article.category]}
          </span>
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
              aria-label={`Read: ${article.title}`}
            >
              Read ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Loading skeleton row ───────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 dark:border-gray-800 animate-pulse">
      <div className="mt-1.5 shrink-0 h-2 w-2 rounded-full bg-gray-200 dark:bg-gray-700" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full" />
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/5" />
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-3/5 mt-1" />
      </div>
    </div>
  );
}

// ── PulseFeed ──────────────────────────────────────────────────────────────────
const ALL_GROUP = "All";
const PAGE_SIZE = 20;

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
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
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

      {/* Article list */}
      {displayed.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          {search.trim() ? `No articles match "${search}"` : "No articles in this category yet."}
        </p>
      ) : (
        <>
          <div>
            {displayed.map((article, idx) => (
              <ArticleRow
                key={`${article.source}-${article.time}-${article.title.slice(0, 24)}-${idx}`}
                article={article}
              />
            ))}
          </div>

          {/* Show more */}
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="mt-3 w-full text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors py-1"
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

