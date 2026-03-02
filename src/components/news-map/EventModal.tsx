import { memo, useEffect } from "react";
import type { CountryNewsData, NewsEvent, EventCategory, EventSeverity, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";
import type { PolymarketMarket } from "../polymarket/types";

/** Maximum number of outcomes displayed per market entry */
const MAX_DISPLAYED_OUTCOMES = 4;

interface EventModalProps {
  country: CountryNewsData | null;
  onClose: () => void;
  /** Polymarket predictions relevant to this country */
  markets?: PolymarketMarket[];
}

const CATEGORY_STYLES: Record<EventCategory, string> = {
  violent:        "bg-error-100 text-error-900 dark:bg-error-900/30 dark:text-error-300",
  terrorism:      "bg-error-200 text-error-900 dark:bg-error-800/40 dark:text-error-200",
  military:       "bg-orange-200 text-orange-900 dark:bg-orange-800/40 dark:text-orange-200",
  escalation:     "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-300",
  diplomatic:     "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300",
  extremism:      "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200",
  economic:       "bg-blue-light-100 text-blue-light-900 dark:bg-blue-light-900/30 dark:text-blue-light-300",
  commodities:    "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200",
  cyber:          "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-300",
  health:         "bg-teal-100 text-teal-900 dark:bg-teal-900/30 dark:text-teal-300",
  environmental:  "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300",
  disaster:       "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
  infrastructure: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-300",
  crime:          "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-300",
  piracy:         "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-300",
  protest:        "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
  minor:          "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
};

/** Alert level badge label + colour */
const ALERT_LEVEL_META: Record<AlertLevel, { label: string; className: string }> = {
  critical: { label: "CRITICAL",  className: "bg-error-800 text-white animate-pulse" },
  high:     { label: "HIGH",      className: "bg-warning-800 text-white" },
  medium:   { label: "MEDIUM",    className: "bg-brand-500 text-gray-900" },
  watch:    { label: "WATCH",     className: "bg-gray-600 text-white" },
};

const SEVERITY_DOT: Record<EventSeverity, string> = {
  high: "bg-error-500",
  medium: "bg-warning-500",
  low: "bg-success-500",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EventRow = memo(function EventRow({ event }: { event: NewsEvent }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 dark:border-gray-800">
      <span
        className={`mt-1.5 shrink-0 h-2 w-2 rounded-full ${SEVERITY_DOT[event.severity]}`}
        title={event.severity}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90 line-clamp-2">
          {event.title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400">{event.source}</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{relativeTime(event.time)}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[event.category]}`}
          >
            {event.category}
          </span>
          {event.confirmations !== undefined && event.confirmations > 1 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300"
              title={`Reported by ${event.confirmations} independent sources`}
            >
              ✓ {event.confirmations} sources
            </span>
          )}
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
              onClick={(e) => e.stopPropagation()}
            >
              Read ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

/** Severity order: high events first, then medium, then low */
const SEVERITY_ORDER: Record<EventSeverity, number> = { high: 0, medium: 1, low: 2 };

export default function EventModal({ country, onClose, markets }: EventModalProps) {
  // Close on Escape key — standard modal accessibility pattern
  useEffect(() => {
    if (!country) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [country, onClose]);

  if (!country) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-theme-xl dark:border-gray-700 dark:bg-gray-dark max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            {country.alertLevel !== "watch" && (
              <span
                className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${ALERT_LEVEL_META[country.alertLevel].className}`}
              >
                {ALERT_LEVEL_META[country.alertLevel].label}
              </span>
            )}
            {country.trending && (
              <span className="shrink-0 inline-flex h-2 w-2 rounded-full bg-error-500 animate-pulse" />
            )}
            <h3 className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
              <span aria-hidden="true">{countryFlag(country.code)} </span>{country.name}
            </h3>
            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
              {country.events.length} event{country.events.length !== 1 ? "s" : ""}
            </span>
            {country.escalationIndex !== undefined && country.escalationIndex > 0 && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                title={`7-day escalation index: ${country.escalationIndex}`}
                aria-label={`Escalation index: ${country.escalationIndex.toFixed(1)}`}
              >
                ↑{country.escalationIndex.toFixed(1)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 custom-scrollbar">
          {/* Polymarket predictions section — shown only when relevant markets exist */}
          {markets && markets.length > 0 && (
            <div className="py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Market Predictions
              </p>
              <div className="space-y-2">
                {markets.slice(0, 3).map((m) => (
                  <a
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-gray-800 dark:bg-white/[0.02] dark:hover:border-brand-700/50 dark:hover:bg-brand-900/10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="font-medium text-gray-700 dark:text-white/80 line-clamp-2 mb-1.5 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
                      {m.question}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {m.outcomes.slice(0, MAX_DISPLAYED_OUTCOMES).map((o) => (
                        <span
                          key={o.label}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                            o.label.toLowerCase() === "yes"
                              ? "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300"
                              : o.label.toLowerCase() === "no"
                              ? "bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {o.probability}% {o.label}
                        </span>
                      ))}
                      <span className="ml-auto text-[10px] text-brand-500 dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        ↗
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Event list — sorted severity-first (high → medium → low), then newest-first */}
          {[...country.events]
            .sort(
              (a, b) =>
                SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
                new Date(b.time).getTime() - new Date(a.time).getTime()
            )
            .map((ev) => (
              <EventRow key={`${ev.title}-${ev.time}`} event={ev} />
            ))}
        </div>
      </div>
    </div>
  );
}
