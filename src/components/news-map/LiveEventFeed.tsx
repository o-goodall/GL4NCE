import { useMemo, memo } from "react";
import type { CountryNewsData, NewsEvent, EventCategory, EventSeverity } from "./types";

interface FeedEntry {
  event: NewsEvent;
  country: CountryNewsData;
}

interface LiveEventFeedProps {
  countries: CountryNewsData[];
  /** Maximum rows to display (default 10) */
  maxRows?: number;
  onCountryClick: (country: CountryNewsData) => void;
}

/** Colour of the severity indicator dot */
const SEVERITY_DOT: Record<EventSeverity, string> = {
  high:   "bg-error-500",
  medium: "bg-warning-500",
  low:    "bg-success-500",
};

/** Compact category label colour */
const CATEGORY_BADGE: Record<EventCategory, string> = {
  violent:    "text-error-600   dark:text-error-400",
  escalation: "text-orange-600  dark:text-orange-400",
  extremism:  "text-brand-600   dark:text-brand-300",
  economic:   "text-blue-600    dark:text-blue-400",
  minor:      "text-warning-600 dark:text-warning-400",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Convert an ISO-3166-1 alpha-2 country code to a flag emoji. */
function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2 || !/^[A-Z]{2}$/.test(upper)) return "";
  return [...upper].map((c) =>
    String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)
  ).join("");
}

const FeedRow = memo(function FeedRow({
  entry,
  onCountryClick,
}: {
  entry: FeedEntry;
  onCountryClick: (c: CountryNewsData) => void;
}) {
  const { event, country } = entry;
  return (
    <div
      className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
      onClick={() => onCountryClick(country)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onCountryClick(country)}
    >
      {/* Severity dot */}
      <span
        className={`shrink-0 h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[event.severity]}`}
        aria-label={event.severity}
      />
      {/* Flag + country */}
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 w-24 truncate">
        <span aria-label={country.name}>{countryFlag(country.code)}</span>
        {" "}
        {country.name}
      </span>
      {/* Title — linked when a URL is available */}
      <span className="flex-1 min-w-0">
        {event.link ? (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-700 dark:text-gray-300 hover:text-brand-500 dark:hover:text-brand-300 truncate block"
            onClick={(e) => e.stopPropagation()}
          >
            {event.title}
          </a>
        ) : (
          <span className="text-xs text-gray-700 dark:text-gray-300 truncate block">
            {event.title}
          </span>
        )}
      </span>
      {/* Category */}
      <span className={`shrink-0 text-[10px] font-medium uppercase ${CATEGORY_BADGE[event.category]}`}>
        {event.category}
      </span>
      {/* Relative time */}
      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums min-w-[2rem] text-right">
        {relativeTime(event.time)}
      </span>
    </div>
  );
});

/**
 * Live event feed — shows the most recent events across all countries,
 * newest first.  Clicking a row opens the country modal for that country.
 *
 * Inspired by liveuamap's real-time event ticker and globalthreatmap's
 * event feed: both surface individual events chronologically rather than
 * just per-country aggregates, giving a clearer sense of what is happening
 * right now worldwide.
 */
export default function LiveEventFeed({
  countries,
  maxRows = 10,
  onCountryClick,
}: LiveEventFeedProps) {
  const feed = useMemo<FeedEntry[]>(() => {
    const entries: FeedEntry[] = [];
    for (const country of countries) {
      for (const event of country.events) {
        entries.push({ event, country });
      }
    }
    // Sort newest first, then cap to maxRows
    entries.sort(
      (a, b) => new Date(b.event.time).getTime() - new Date(a.event.time).getTime()
    );
    return entries.slice(0, maxRows);
  }, [countries, maxRows]);

  if (feed.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Live Feed
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {feed.length} latest event{feed.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div>
        {feed.map((entry, idx) => (
          <FeedRow
            key={`${entry.country.code}-${entry.event.time}-${idx}`}
            entry={entry}
            onCountryClick={onCountryClick}
          />
        ))}
      </div>
    </div>
  );
}
