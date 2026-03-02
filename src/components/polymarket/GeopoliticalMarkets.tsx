import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePolymarket } from "./usePolymarket";
import type { PolymarketMarket } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────
/** Max outcomes shown on a full-size mobile card */
const MAX_DISPLAYED_OUTCOMES = 4;
/** Max outcomes shown on a compact desktop card */
const MAX_COMPACT_OUTCOMES = 2;
/** Cards grouped per carousel page on mobile */
const MOBILE_CARDS_PER_PAGE = 3;
/** Auto-advance interval (ms) */
const AUTO_SLIDE_MS = 5_000;
/** Delay before resuming auto-slide after user interaction (ms) */
const RESUME_AFTER_MS = 3_500;
/** Probability-point swing that constitutes a significant flip */
const FLIP_THRESHOLD_PP = 30;

/** Minimum horizontal swipe distance (px) to trigger page navigation */
const SWIPE_THRESHOLD_PX = 40;

const POLYMARKET_BASE = "https://polymarket.com";

// ── Flip-detection helpers ────────────────────────────────────────────────────
type ProbMap = Map<string, number>;       // outcomeLabel → probability
type Snapshot = Map<string, ProbMap>;    // marketId     → ProbMap

function snapshotMarkets(markets: PolymarketMarket[]): Snapshot {
  return new Map(
    markets.map((m) => [m.id, new Map(m.outcomes.map((o) => [o.label, o.probability]))])
  );
}

function detectFlips(markets: PolymarketMarket[], prev: Snapshot): Set<string> {
  const flipped = new Set<string>();
  for (const m of markets) {
    const prevProbs = prev.get(m.id);
    if (!prevProbs) continue; // no baseline yet — skip
    for (const o of m.outcomes) {
      if (Math.abs(o.probability - (prevProbs.get(o.label) ?? 0)) >= FLIP_THRESHOLD_PP) {
        flipped.add(m.id);
        break;
      }
    }
  }
  return flipped;
}

// ── Utility formatters ────────────────────────────────────────────────────────
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function formatEndDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── OutcomeBar ────────────────────────────────────────────────────────────────
function OutcomeBar({ label, probability }: { label: string; probability: number }) {
  const isYes = label.toLowerCase() === "yes";
  const isNo  = label.toLowerCase() === "no";
  const barColor = isYes ? "bg-success-500" : isNo ? "bg-error-400" : "bg-brand-400";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-6 shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400 text-right tabular-nums">
        {probability}%
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-500`}
          style={{ width: `${probability}%` }}
          role="progressbar"
          aria-valuenow={probability}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${probability}%`}
        />
      </div>
      <span className="w-16 shrink-0 text-[11px] text-gray-500 dark:text-gray-400 truncate">
        {label}
      </span>
    </div>
  );
}

// ── MarketCard ────────────────────────────────────────────────────────────────
function MarketCard({
  market,
  flipped = false,
  compact = false,
}: {
  market: PolymarketMarket;
  flipped?: boolean;
  compact?: boolean;
}) {
  const maxOutcomes = compact ? MAX_COMPACT_OUTCOMES : MAX_DISPLAYED_OUTCOMES;

  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "group block rounded-xl border transition-colors",
        compact ? "px-3 py-2" : "px-4 py-3",
        flipped
          ? "border-warning-400 bg-warning-50/30 hover:border-warning-500 dark:border-warning-600/60 dark:bg-warning-900/10 dark:hover:border-warning-500"
          : "border-gray-100 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40 dark:border-gray-800 dark:bg-white/[0.02] dark:hover:border-brand-700/50 dark:hover:bg-brand-900/10",
      ].join(" ")}
      title="View on Polymarket ↗"
    >
      {/* Flip badge */}
      {flipped && (
        <p className="flex items-center gap-1 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning-600 dark:text-warning-400">
          <span aria-hidden="true">⚡</span> Odds shifted
        </p>
      )}

      {/* Question */}
      <p
        className={[
          "font-medium text-gray-800 dark:text-white/90 line-clamp-2 mb-2",
          "group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors",
          compact ? "text-xs" : "text-sm",
        ].join(" ")}
      >
        {market.question}
      </p>

      {/* Outcome bars */}
      <div className="space-y-1 mb-2">
        {market.outcomes.slice(0, maxOutcomes).map((o) => (
          <OutcomeBar key={o.label} label={o.label} probability={o.probability} />
        ))}
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
        <span>{formatVolume(market.volume)} vol</span>
        {market.endDate && (
          <>
            <span aria-hidden="true">·</span>
            <span>Resolves {formatEndDate(market.endDate)}</span>
          </>
        )}
        <span className="ml-auto text-brand-500 dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">
          ↗
        </span>
      </div>
    </a>
  );
}

// ── SkeletonCard ──────────────────────────────────────────────────────────────
function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={[
        "rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]",
        compact ? "px-3 py-2" : "px-4 py-3",
      ].join(" ")}
    >
      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse motion-reduce:animate-none mb-2" />
      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse motion-reduce:animate-none mb-3" />
      <div className="space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse motion-reduce:animate-none" />
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}

// ── FlipBanner ────────────────────────────────────────────────────────────────
function FlipBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg bg-warning-50 border border-warning-200 dark:bg-warning-900/20 dark:border-warning-700/40"
      role="status"
      aria-live="polite"
    >
      <span className="text-[11px] font-semibold text-warning-700 dark:text-warning-400">
        ⚡ {count} prediction{count !== 1 ? "s" : ""} shifted significantly
      </span>
    </div>
  );
}

// ── MobileCarousel ────────────────────────────────────────────────────────────
/**
 * Displays `MOBILE_CARDS_PER_PAGE` (3) stacked cards per page.
 * Auto-advances every AUTO_SLIDE_MS (5 s); pauses on touch/key interaction
 * and resumes RESUME_AFTER_MS (3.5 s) later.  Wraps around at the end.
 * Respects prefers-reduced-motion: disables both transitions and auto-slide.
 */
function MobileCarousel({
  markets,
  flippedIds,
}: {
  markets: PolymarketMarket[];
  flippedIds: Set<string>;
}) {
  const totalPages = Math.ceil(markets.length / MOBILE_CARDS_PER_PAGE);
  const [currentPage, setCurrentPage] = useState(0);

  // Dynamic reduced-motion preference (subscribes to OS changes)
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Stable refs so interval callbacks don't capture stale closures
  const totalPagesRef   = useRef(totalPages);
  const reducedMotionRef = useRef(reducedMotion);
  const autoTimerRef    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const resumeTimerRef  = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const touchStartXRef  = useRef(0);

  totalPagesRef.current   = totalPages;
  reducedMotionRef.current = reducedMotion;

  // Reset to first page when market count changes
  useEffect(() => {
    setCurrentPage(0);
  }, [totalPages]);

  // Auto-slide management (stable – reads only refs)
  const startAutoSlide = useCallback(() => {
    if (reducedMotionRef.current) return;
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    autoTimerRef.current = setInterval(() => {
      setCurrentPage((p) => (p + 1) % totalPagesRef.current);
    }, AUTO_SLIDE_MS);
  }, []);

  const stopAll = useCallback(() => {
    if (autoTimerRef.current)   { clearInterval(autoTimerRef.current);  autoTimerRef.current  = null; }
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
  }, []);

  const pauseAndResume = useCallback(() => {
    stopAll();
    if (!reducedMotionRef.current) {
      resumeTimerRef.current = setTimeout(startAutoSlide, RESUME_AFTER_MS);
    }
  }, [stopAll, startAutoSlide]);

  // Kick off auto-slide and clean up on unmount / totalPages change
  useEffect(() => {
    if (totalPages > 1) startAutoSlide();
    return stopAll;
  }, [startAutoSlide, stopAll, totalPages]);

  // Stop auto-slide immediately when user enables reduced motion
  useEffect(() => {
    if (reducedMotion) stopAll();
    else if (totalPages > 1) startAutoSlide();
  }, [reducedMotion, startAutoSlide, stopAll, totalPages]);

  const goToPage = useCallback(
    (page: number) => {
      if (totalPagesRef.current === 0) return;
      setCurrentPage(Math.max(0, Math.min(page, totalPagesRef.current - 1)));
      pauseAndResume();
    },
    [pauseAndResume],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    pauseAndResume();
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX) goToPage(currentPage + (dx < 0 ? 1 : -1));
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft")  goToPage(currentPage - 1);
    if (e.key === "ArrowRight") goToPage(currentPage + 1);
  };

  const pages = Array.from({ length: totalPages }, (_, i) =>
    markets.slice(i * MOBILE_CARDS_PER_PAGE, (i + 1) * MOBILE_CARDS_PER_PAGE),
  );
  // Track width = totalPages × 100%; each slide = 1/totalPages of track = 100% of viewport
  const slidePercent = totalPages > 0 ? 100 / totalPages : 100;
  const offset = currentPage * slidePercent;

  return (
    <div className="sm:hidden">
      <FlipBanner count={flippedIds.size} />

      {/* Carousel viewport */}
      <div
        className="overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`Market predictions, page ${currentPage + 1} of ${totalPages}`}
      >
        <div
          style={{
            display: "flex",
            width: `${totalPages * 100}%`,
            transform: `translateX(-${offset}%)`,
            transition: reducedMotion ? "none" : "transform 300ms ease-in-out",
          }}
        >
          {pages.map((page, pageIdx) => (
            <div
              key={pageIdx}
              style={{ width: `${slidePercent}%` }}
              className="flex flex-col gap-2"
              aria-roledescription="slide"
              aria-label={`Page ${pageIdx + 1} of ${totalPages}`}
              aria-hidden={pageIdx !== currentPage}
            >
              {page.map((m) => (
                <MarketCard key={m.id} market={m} flipped={flippedIds.has(m.id)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Screen-reader page announcer */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Page {currentPage + 1} of {totalPages}
      </div>

      {/* Dot navigation */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-center gap-2 mt-3"
          role="tablist"
          aria-label="Carousel page navigation"
        >
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === currentPage}
              aria-label={`Go to page ${i + 1} of ${totalPages}`}
              onClick={() => goToPage(i)}
              className={[
                "rounded-full transition-all duration-200 motion-reduce:transition-none",
                i === currentPage
                  ? "w-5 h-1.5 bg-brand-500"
                  : "w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500",
              ].join(" ")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── DesktopList ───────────────────────────────────────────────────────────────
/**
 * Compact single-column list of all markets with a max-height overflow scroll.
 * Approximately 5 cards visible before scrolling.
 */
function DesktopList({
  markets,
  flippedIds,
}: {
  markets: PolymarketMarket[];
  flippedIds: Set<string>;
}) {
  return (
    <div className="hidden sm:block">
      <FlipBanner count={flippedIds.size} />
      <div
        className="flex flex-col gap-2 overflow-y-auto pr-0.5"
        style={{ maxHeight: "480px", scrollbarWidth: "thin" }}
        aria-label="Market predictions"
      >
        {markets.map((m) => (
          <MarketCard key={m.id} market={m} flipped={flippedIds.has(m.id)} compact />
        ))}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function GeopoliticalMarkets() {
  const { markets, loading, error } = usePolymarket();

  // Flip detection: compare current probabilities against the previous snapshot
  const prevSnapshotRef = useRef<Snapshot>(new Map());
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (markets.length === 0) return;
    const newFlipped = detectFlips(markets, prevSnapshotRef.current);
    setFlippedIds(newFlipped);
    prevSnapshotRef.current = snapshotMarkets(markets);
  }, [markets]);

  // Sort markets by "Yes" outcome probability (highest first) for display.
  // Markets with no "Yes" outcome fall to the bottom (treated as 0%).
  const sortedMarkets = useMemo(
    () =>
      [...markets].sort((a, b) => {
        const yesA = a.outcomes.find((o) => o.label.toLowerCase() === "yes")?.probability ?? 0;
        const yesB = b.outcomes.find((o) => o.label.toLowerCase() === "yes")?.probability ?? 0;
        return yesB - yesA;
      }),
    [markets],
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Triggers</h3>
          <p className="mt-1 text-gray-500 text-theme-sm dark:text-gray-400">
            Crowd-sourced probability markets from{" "}
            <a
              href={POLYMARKET_BASE}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-brand-600 dark:hover:text-brand-300"
            >
              Polymarket
            </a>
          </p>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <>
          {/* Mobile skeleton: 3 stacked cards */}
          <div className="flex flex-col gap-2 sm:hidden">
            {Array.from({ length: MOBILE_CARDS_PER_PAGE }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          {/* Desktop skeleton: 5 compact stacked cards */}
          <div className="hidden sm:flex sm:flex-col sm:gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonCard key={i} compact />
            ))}
          </div>
        </>
      ) : error ? (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
          Market data unavailable
        </p>
      ) : markets.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
          No active markets found
        </p>
      ) : (
        <>
          <MobileCarousel markets={sortedMarkets} flippedIds={flippedIds} />
          <DesktopList markets={sortedMarkets} flippedIds={flippedIds} />
        </>
      )}
    </div>
  );
}
