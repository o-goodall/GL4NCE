import { useMemo, memo, useState } from "react";
import type { CountryNewsData, NewsEvent, EventCategory, EventSeverity } from "./types";
import { countryFlag } from "./mapUtils";

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
      {/* Title — plain text in the feed row; use the Read pill for the link */}
      <span className="flex-1 min-w-0">
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate block">
          {event.title}
        </span>
      </span>
      {/* Read pill — opens story in new tab; stopPropagation prevents opening country modal */}
      {event.link && (
        <a
          href={event.link}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Read article: ${event.title}`}
        >
          ↗
        </a>
      )}
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

/** Hard cap on the "expanded" view (keeps the component from growing unbounded) */
const MAX_ROWS_EXPANDED = 25;

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
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  // All events sorted newest-first, capped at MAX_ROWS_EXPANDED to avoid
  // storing an unbounded list in memory — only the most-recent rows matter.
  const allFeed = useMemo<FeedEntry[]>(() => {
    const entries: FeedEntry[] = [];
    for (const country of countries) {
      for (const event of country.events) {
        entries.push({ event, country });
      }
    }
    entries.sort(
      (a, b) => new Date(b.event.time).getTime() - new Date(a.event.time).getTime()
    );
    return entries.slice(0, MAX_ROWS_EXPANDED);
  }, [countries]);

  // Apply keyword search — filter by title, country name, or source.
  // Then cap to `maxRows` (collapsed) or `MAX_ROWS_EXPANDED` (expanded).
  const feed = useMemo<FeedEntry[]>(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allFeed.filter(
          ({ event, country }) =>
            event.title.toLowerCase().includes(q) ||
            country.name.toLowerCase().includes(q) ||
            event.source.toLowerCase().includes(q)
        )
      : allFeed;
    return filtered.slice(0, expanded ? MAX_ROWS_EXPANDED : maxRows);
  }, [allFeed, search, expanded, maxRows]);

  // When the user starts searching, auto-expand so they see all matching results.
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    if (e.target.value.trim()) setExpanded(true);
  };

  const canExpand = !expanded && allFeed.length > maxRows && !search.trim();

  if (allFeed.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
      {/* Header row: title + search input */}
      <div className="flex items-center gap-2 mb-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Live Feed
        </span>
        <input
          type="search"
          value={search}
          onChange={handleSearch}
          placeholder="Filter events…"
          aria-label="Filter live feed events"
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-brand-500"
        />
      </div>
      <div>
        {feed.length > 0 ? (
          feed.map((entry, idx) => (
            <FeedRow
              key={`${entry.country.code}-${entry.event.time}-${idx}`}
              entry={entry}
              onCountryClick={onCountryClick}
            />
          ))
        ) : (
          <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">
            No events match &ldquo;{search}&rdquo;
          </p>
        )}
      </div>
      {/* Show more / show less toggle */}
      {(canExpand || expanded) && !search.trim() && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 w-full text-center text-[10px] font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors py-0.5"
        >
          {expanded
            ? "Show less ↑"
            : `Show ${Math.max(1, Math.min(MAX_ROWS_EXPANDED, allFeed.length) - maxRows)} more ↓`}
        </button>
      )}
    </div>
  );
}
