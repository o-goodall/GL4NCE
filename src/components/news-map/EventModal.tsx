import { memo, useEffect } from "react";
import type { CountryNewsData, NewsEvent, EventCategory, EventSeverity, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";

interface EventModalProps {
  country: CountryNewsData | null;
  onClose: () => void;
}

const CATEGORY_STYLES: Record<EventCategory, string> = {
  violent:    "bg-error-100 text-error-900 dark:bg-error-900/30 dark:text-error-300",
  minor:      "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
  economic:   "bg-blue-light-100 text-blue-light-900 dark:bg-blue-light-900/30 dark:text-blue-light-300",
  extremism:  "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200",
  escalation: "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-300",
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
        {event.link ? (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-gray-800 dark:text-white/90 hover:text-brand-500 dark:hover:text-brand-200 line-clamp-2"
          >
            {event.title}
          </a>
        ) : (
          <p className="text-sm font-medium text-gray-800 dark:text-white/90 line-clamp-2">{event.title}</p>
        )}
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
        </div>
      </div>
    </div>
  );
});

/** Severity order: high events first, then medium, then low */
const SEVERITY_ORDER: Record<EventSeverity, number> = { high: 0, medium: 1, low: 2 };

export default function EventModal({ country, onClose }: EventModalProps) {
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

        {/* Event list — sorted severity-first (high → medium → low), then newest-first */}
        <div className="overflow-y-auto flex-1 px-5 custom-scrollbar">
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
