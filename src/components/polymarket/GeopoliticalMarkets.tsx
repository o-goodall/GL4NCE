import { useState } from "react";
import { usePolymarket } from "./usePolymarket";
import type { PolymarketMarket } from "./types";

/** Maximum number of outcomes displayed per market card / modal entry */
const MAX_DISPLAYED_OUTCOMES = 4;
/** Number of cards shown before the "See More" button */
const INITIAL_VISIBLE = 6;

const POLYMARKET_BASE = "https://polymarket.com";

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function formatEndDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** Probability bar for a single outcome */
function OutcomeBar({ label, probability }: { label: string; probability: number }) {
  const isYes = label.toLowerCase() === "yes";
  const isNo = label.toLowerCase() === "no";
  const barColor = isYes
    ? "bg-success-500"
    : isNo
    ? "bg-error-400"
    : "bg-brand-400";

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

function MarketCard({ market }: { market: PolymarketMarket }) {
  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-gray-800 dark:bg-white/[0.02] dark:hover:border-brand-700/50 dark:hover:bg-brand-900/10"
      title="View on Polymarket ↗"
    >
      {/* Question */}
      <p className="text-sm font-medium text-gray-800 dark:text-white/90 line-clamp-2 mb-2 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
        {market.question}
      </p>

      {/* Outcome probability bars */}
      <div className="space-y-1 mb-2">
        {market.outcomes.slice(0, MAX_DISPLAYED_OUTCOMES).map((o) => (
          <OutcomeBar key={o.label} label={o.label} probability={o.probability} />
        ))}
      </div>

      {/* Meta: volume + end date */}
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

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-2" />
      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-3" />
      <div className="space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

export default function GeopoliticalMarkets() {
  const { markets, loading, error } = usePolymarket();
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? markets : markets.slice(0, INITIAL_VISIBLE);
  const hasMore = markets.length > INITIAL_VISIBLE;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Geopolitical Market Predictions
            </h3>
          </div>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visible.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:border-brand-600 dark:hover:bg-brand-900/20 dark:hover:text-brand-300"
                aria-expanded={expanded}
              >
                {expanded ? (
                  <>
                    See Less
                    <span aria-hidden="true">↑</span>
                  </>
                ) : (
                  <>
                    See More
                    <span className="inline-flex items-center justify-center rounded-full bg-gray-200 px-1.5 text-[10px] dark:bg-gray-700">
                      +{markets.length - INITIAL_VISIBLE}
                    </span>
                    <span aria-hidden="true">↓</span>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
