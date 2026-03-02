import { useState, useMemo, memo, useCallback, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { usePulse } from "./usePulse";
import {
  PULSE_CATEGORY_GROUPS,
  PULSE_CATEGORY_LABEL,
  PULSE_GROUP_SHORT_LABEL,
  type PulseArticle,
  type PulseCategory,
} from "./types";

// ── Category gradients — dark-to-lighter header backgrounds ──────────────────
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

// ── Category icons — heroicons-outline SVG path strings ───────────────────────
const CATEGORY_ICON_PATH: Record<PulseCategory, string> = {
  // ExclamationTriangle
  violent:        "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
  // Bolt
  terrorism:      "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z",
  // ShieldCheck
  military:       "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  // ArrowTrendingUp
  escalation:     "M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941",
  // GlobeAlt (meridian lines)
  diplomatic:     "M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418",
  // ExclamationCircle
  extremism:      "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z",
  // ChartBarSquare
  economic:       "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z",
  // Cube
  commodities:    "M21 7.5l-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
  // LockClosed
  cyber:          "M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z",
  // Heart
  health:         "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z",
  // Cloud
  environmental:  "M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z",
  // ExclamationTriangle (same shape, different gradient)
  disaster:       "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
  // BuildingOffice2
  infrastructure: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
  // MagnifyingGlass
  crime:          "M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z",
  // Globe (simplified meridians only)
  piracy:         "M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3",
  // Megaphone
  protest:        "M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46",
  // InformationCircle
  minor:          "M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z",
  // UserCircle / person silhouette
  human_rights:   "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z",
  // ArrowRight (person moving)
  migration:      "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3",
  // GlobeAlt (same as diplomatic, different gradient)
  geopolitics:    "M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418",
  // Bolt (same shape, lime gradient)
  energy:         "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z",
  // CurrencyDollar
  crypto:         "M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.171-.879-1.171-2.303 0-3.182.53-.398 1.258-.597 2.003-.597m0 0V6m0 12v-2.818",
  // CpuChip
  technology:     "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z",
  // Eye
  ai_ethics:      "M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
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

// ── CategoryIcon — small heroicon in a glassy circle ─────────────────────────
function CategoryIcon({ category }: { category: PulseCategory }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 transition-transform duration-200 group-hover:scale-110">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="h-4 w-4 text-white"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={CATEGORY_ICON_PATH[category]} />
      </svg>
    </span>
  );
}

// ── ArticleCard ────────────────────────────────────────────────────────────────
const ArticleCard = memo(function ArticleCard({
  article,
  isNew,
}: {
  article: PulseArticle;
  isNew: boolean;
}) {
  const gradient = CATEGORY_GRADIENT[article.category];
  return (
    <div
      className={clsx(
        "group flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
        isNew && "animate-card-fade-in",
      )}
    >
      {/* Gradient header */}
      <div className={`flex flex-col gap-2 p-3 bg-gradient-to-br ${gradient}`}>
        {/* Top row: icon + category badge + time */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CategoryIcon category={article.category} />
            <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white truncate">
              {PULSE_CATEGORY_LABEL[article.category]}
            </span>
          </div>
          <span className="text-[10px] text-white/60 tabular-nums shrink-0">
            {relativeTime(article.time)}
          </span>
        </div>
        {/* Title */}
        <h3
          className="text-sm font-semibold text-white leading-snug line-clamp-2"
          title={article.title}
        >
          {article.title}
        </h3>
        {/* Description */}
        {article.description && (
          <p className="text-xs text-white/75 leading-relaxed line-clamp-1">
            {article.description}
          </p>
        )}
        {/* Read More */}
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
      {/* Meta footer */}
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
      <div className="p-3 bg-gray-800/60 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-white/10 shrink-0" />
            <div className="h-4 bg-white/10 rounded-full w-20" />
          </div>
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
const LOADING_DELAY_MS = 300;

export default function PulseFeed() {
  const { data, loading, error, refresh } = usePulse();
  const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUP);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Sentinel element for IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guard: prevents the observer from firing multiple times before state settles
  const isLoadingRef = useRef(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Index of the first card added in this page increment (for fade-in)
  const firstNewIdx = (page - 1) * PAGE_SIZE;

  // ── Infinite scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || isLoadingRef.current) return;
        isLoadingRef.current = true;
        setIsLoadingMore(true);
        // Brief visual delay so the spinner registers before cards appear
        loadingTimerRef.current = setTimeout(() => {
          setPage((p) => p + 1);
          setIsLoadingMore(false);
          isLoadingRef.current = false;
        }, LOADING_DELAY_MS);
      },
      { rootMargin: "100px 0px" },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [hasMore]);

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
                isNew={idx >= firstNewIdx}
              />
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />

          {/* Loading spinner — shown while next page loads */}
          {isLoadingMore && (
            <div className="flex justify-center py-4" aria-label="Loading more articles">
              <span className="block h-5 w-5 rounded-full border-2 border-brand-500 border-t-transparent animate-spin dark:border-brand-400 dark:border-t-transparent" />
            </div>
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

