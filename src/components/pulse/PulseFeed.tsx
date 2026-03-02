import { useState, useMemo, memo, useCallback } from "react";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  PULSE_GROUP_SHORT_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Category colours — badge overlays on images + subtle accent for fallbacks ─
const CATEGORY_COLOUR: Record<PulseCategory, { badge: string; accent: string; icon: string }> = {
  violent:        { badge: "bg-red-600/90     text-white", accent: "bg-red-600",      icon: "⚔️" },
  terrorism:      { badge: "bg-red-700/90     text-white", accent: "bg-red-700",      icon: "💥" },
  military:       { badge: "bg-orange-600/90  text-white", accent: "bg-orange-600",   icon: "🎖️" },
  escalation:     { badge: "bg-orange-500/90  text-white", accent: "bg-orange-500",   icon: "📈" },
  diplomatic:     { badge: "bg-purple-600/90  text-white", accent: "bg-purple-600",   icon: "🤝" },
  extremism:      { badge: "bg-pink-600/90    text-white", accent: "bg-pink-600",     icon: "⚠️" },
  economic:       { badge: "bg-blue-600/90    text-white", accent: "bg-blue-600",     icon: "📊" },
  commodities:    { badge: "bg-blue-700/90    text-white", accent: "bg-blue-700",     icon: "🛢️" },
  cyber:          { badge: "bg-indigo-600/90  text-white", accent: "bg-indigo-600",   icon: "🔒" },
  health:         { badge: "bg-teal-600/90    text-white", accent: "bg-teal-600",     icon: "🏥" },
  environmental:  { badge: "bg-green-600/90   text-white", accent: "bg-green-600",    icon: "🌍" },
  disaster:       { badge: "bg-amber-600/90   text-white", accent: "bg-amber-600",    icon: "🌊" },
  infrastructure: { badge: "bg-yellow-600/90  text-white", accent: "bg-yellow-600",   icon: "🏗️" },
  crime:          { badge: "bg-rose-600/90    text-white", accent: "bg-rose-600",     icon: "🚨" },
  piracy:         { badge: "bg-cyan-600/90    text-white", accent: "bg-cyan-600",     icon: "⚓" },
  protest:        { badge: "bg-yellow-500/90  text-white", accent: "bg-yellow-500",   icon: "✊" },
  minor:          { badge: "bg-gray-500/90    text-white", accent: "bg-gray-500",     icon: "📰" },
  human_rights:   { badge: "bg-fuchsia-600/90 text-white", accent: "bg-fuchsia-600",  icon: "✋" },
  migration:      { badge: "bg-sky-600/90     text-white", accent: "bg-sky-600",      icon: "🧭" },
  geopolitics:    { badge: "bg-violet-600/90  text-white", accent: "bg-violet-600",   icon: "🌐" },
  energy:         { badge: "bg-lime-600/90    text-white", accent: "bg-lime-600",     icon: "⚡" },
  crypto:         { badge: "bg-yellow-500/90  text-white", accent: "bg-yellow-500",   icon: "₿" },
  technology:     { badge: "bg-indigo-500/90  text-white", accent: "bg-indigo-500",   icon: "🚀" },
  ai_ethics:      { badge: "bg-purple-500/90  text-white", accent: "bg-purple-500",   icon: "🤖" },
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

/** Derive a 2-4 char outlet abbreviation (e.g. "Al Jazeera" → "AJ", "BBC" → "BBC") */
function sourceAbbr(source: string): string {
  const words = source.split(/\s+/);
  const abbr = words.length === 1
    ? source.slice(0, 4).toUpperCase()
    : words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
  // Ensure at least 2 chars so the watermark always has visual weight
  return abbr.length >= 2 ? abbr : abbr.padEnd(2, abbr[0] ?? "?");
}

// ── ArticleCard ────────────────────────────────────────────────────────────────
interface ArticleCardProps {
  article: PulseArticle;
  /** When true, renders a taller "featured" card (first item) */
  featured?: boolean;
}

const ArticleCard = memo(function ArticleCard({ article, featured = false }: ArticleCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const colour = CATEGORY_COLOUR[article.category];
  const showImage = article.image && !imgFailed;
  const abbr = sourceAbbr(article.source);

  const cardContent = (
    <>
      {/* Image / fallback */}
      <div className={`relative w-full overflow-hidden bg-gray-950 ${featured ? "aspect-[16/8]" : "aspect-[16/9]"}`}>
        {showImage ? (
          <img
            src={article.image}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <>
            {/* Thin category colour bar at top */}
            <div className={`absolute top-0 left-0 right-0 h-[3px] ${colour.accent}`} />
            {/* Source abbreviation watermark */}
            <span
              className="absolute inset-0 flex items-center justify-center font-black tracking-widest text-white/[0.07] select-none"
              style={{ fontSize: featured ? "5rem" : "3.5rem" }}
              aria-hidden="true"
            >
              {abbr}
            </span>
          </>
        )}
        {/* Gradient overlay for badge legibility — always present */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        {/* Category badge — bottom-left */}
        <span className={`absolute bottom-2 left-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colour.badge}`}>
          {PULSE_CATEGORY_LABEL[article.category]}
        </span>
        {/* Time — bottom-right */}
        <span className="absolute bottom-2 right-2 text-[10px] text-white/70 tabular-nums">
          {relativeTime(article.time)} ago
        </span>
      </div>

      {/* Text content */}
      <div className="flex flex-col flex-1 p-3 gap-1.5">
        <p className={`font-semibold text-gray-900 dark:text-white/90 leading-snug ${featured ? "text-base line-clamp-3" : "text-sm line-clamp-2"}`}>
          {article.title}
        </p>
        {article.description && (
          <p className={`text-xs text-gray-500 dark:text-gray-400 leading-relaxed ${featured ? "line-clamp-3" : "line-clamp-2"}`}>
            {article.description}
          </p>
        )}
        <p className="mt-auto pt-1.5 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {article.author ? (
            <>
              <span className="font-medium text-gray-500 dark:text-gray-400">{article.author}</span>
              <span className="mx-1 opacity-50">·</span>
            </>
          ) : null}
          {article.source}
        </p>
      </div>
    </>
  );

  const baseClass = `group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`;

  if (article.link) {
    return (
      <a
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass}
        aria-label={article.title}
      >
        {cardContent}
      </a>
    );
  }
  return <div className={baseClass}>{cardContent}</div>;
});

// ── Loading skeleton card ──────────────────────────────────────────────────────
function SkeletonCard({ featured = false }: { featured?: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse">
      <div className={`w-full bg-gray-800/60 ${featured ? "aspect-[16/8]" : "aspect-[16/9]"}`} />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full" />
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/5" />
        {featured && <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-full" />}
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mt-0.5" />
        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded w-2/5 mt-1" />
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

  // Derive the set of categories for the active group
  const groupCategories = useMemo<PulseCategory[] | null>(() => {
    if (activeGroup === ALL_GROUP) return null;
    return (
      PULSE_CATEGORY_GROUPS.find((g) => g.label === activeGroup)?.categories ?? null
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

  const totalShown = Math.min(page * PAGE_SIZE, filtered.length);
  const displayed = filtered.slice(0, totalShown);
  const hasMore = totalShown < filtered.length;

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">General News / Context</p>
        </div>
        {/* Featured skeleton */}
        <SkeletonCard featured />
        {/* Grid skeleton */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
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

  const [featured, ...rest] = displayed;

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 pb-6 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
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

      {/* Category tabs — horizontal scroll on mobile, no wrapping */}
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
            {/* Short label on mobile, full label on sm+ */}
            <span className="sm:hidden">{PULSE_GROUP_SHORT_LABEL[group.label] ?? group.label}</span>
            <span className="hidden sm:inline">{group.label}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={handleSearch}
          placeholder="Search articles…"
          aria-label="Search pulse articles"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-brand-500"
        />
      </div>

      {/* Empty state */}
      {displayed.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          {search.trim() ? `No articles match "${search}"` : "No articles in this category yet."}
        </p>
      ) : (
        <>
          {/* Featured card — full width at top */}
          {featured && (
            <div className="mb-3">
              <ArticleCard article={featured} featured />
            </div>
          )}

          {/* Article grid — 2 col on mobile, 3 col on md, 4 col on xl */}
          {rest.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {rest.map((article, idx) => (
                <ArticleCard
                  key={`${article.source}-${article.time}-${article.title.slice(0, 24)}-${idx}`}
                  article={article}
                />
              ))}
            </div>
          )}

          {/* Load more */}
          {hasMore && (
            <div className="mt-5 flex justify-center">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="rounded-full border border-brand-300 bg-brand-50 px-5 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      {data && (
        <p className="mt-5 text-center text-[10px] text-gray-300 dark:text-gray-700">
          Showing {totalShown} of {filtered.length} articles
          {data.lastUpdated && ` · updated ${relativeTime(data.lastUpdated)} ago`}
        </p>
      )}
    </div>
  );
}

