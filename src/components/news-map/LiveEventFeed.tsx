import { useMemo, memo, useState, useEffect, useCallback } from "react";
import type { CountryNewsData, NewsEvent, EventCategory, EventSeverity, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";
import { CONFLICT_STATUS_DOT, CONFLICT_STATUS_LABEL } from "./conflictUtils";

interface FeedEntry {
  event: NewsEvent;
  country: CountryNewsData;
}

interface LiveEventFeedProps {
  countries: CountryNewsData[];
  /** Maximum rows to display (default 10) */
  maxRows?: number;
  /** Called when a row is clicked — now optional; rows show inline detail instead */
  onCountryClick?: (country: CountryNewsData) => void;
  /**
   * When true, renders without the outer rounded wrapper — designed for use
   * inside a pre-styled side panel or bottom sheet.  Enables vertical snap
   * scroll on the feed container.
   */
  panelMode?: boolean;
  /**
   * Externally-selected country (e.g. from a map click).  When set, the feed
   * switches to the inline detail view for this country.
   */
  activeCountry?: CountryNewsData | null;
  /**
   * Called when the user dismisses the detail view so the parent can clear
   * the externally-selected country.
   */
  onDismissActive?: () => void;
}

/** Colour of the severity indicator dot */
const SEVERITY_DOT: Record<EventSeverity, string> = {
  high:   "bg-error-500",
  medium: "bg-warning-500",
  low:    "bg-success-500",
};

/** Compact category label colour */
const CATEGORY_BADGE: Record<EventCategory, string> = {
  violent:        "text-error-600   dark:text-error-400",
  terrorism:      "text-error-700   dark:text-error-300",
  military:       "text-orange-700  dark:text-orange-300",
  escalation:     "text-orange-600  dark:text-orange-400",
  diplomatic:     "text-purple-600  dark:text-purple-400",
  extremism:      "text-brand-600   dark:text-brand-300",
  economic:       "text-blue-600    dark:text-blue-400",
  commodities:    "text-blue-700    dark:text-blue-300",
  cyber:          "text-indigo-600  dark:text-indigo-400",
  health:         "text-teal-600    dark:text-teal-400",
  environmental:  "text-green-600   dark:text-green-400",
  disaster:       "text-amber-600   dark:text-amber-400",
  infrastructure: "text-yellow-600  dark:text-yellow-400",
  crime:          "text-rose-600    dark:text-rose-400",
  piracy:         "text-cyan-600    dark:text-cyan-400",
  protest:        "text-warning-600 dark:text-warning-400",
  minor:          "text-warning-600 dark:text-warning-400",
};

/** Alert level badge styles for the inline detail header */
const ALERT_LEVEL_BADGE: Record<AlertLevel, string> = {
  critical: "bg-error-100 text-error-800 dark:bg-error-900/30 dark:text-error-300",
  high:     "bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400",
  medium:   "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300",
  watch:    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  watch:    "Watch",
};

/** Severity sort order for the detail view events list */
const SEVERITY_ORDER: Record<EventSeverity, number> = { high: 0, medium: 1, low: 2 };

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ── EventDetailRow ─────────────────────────────────────────────────────────────
/** Single event row used inside the inline country detail view */
const EventDetailRow = memo(function EventDetailRow({ event }: { event: NewsEvent }) {
  return (
    <div className="flex items-start gap-2 py-2.5 border-b border-gray-100 last:border-0 dark:border-gray-800">
      <span
        className={`mt-1 shrink-0 h-2 w-2 rounded-full ${SEVERITY_DOT[event.severity]}`}
        aria-label={event.severity}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90 leading-snug">
          {event.title}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[10px] text-gray-400 dark:text-gray-500">
          <span className="truncate">{event.source}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{relativeTime(event.time)}</span>
          <span aria-hidden="true">·</span>
          <span className={`font-medium uppercase ${CATEGORY_BADGE[event.category]}`}>
            {event.category}
          </span>
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
              aria-label={`Read: ${event.title}`}
            >
              Read ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

// ── CountryDetail ──────────────────────────────────────────────────────────────
/** Inline country detail — replaces the full-screen EventModal in the feed panel */
const CountryDetail = memo(function CountryDetail({
  country,
  onBack,
}: {
  country: CountryNewsData;
  onBack: () => void;
}) {
  const sortedEvents = useMemo(
    () =>
      [...country.events].sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          new Date(b.time).getTime() - new Date(a.time).getTime(),
      ),
    [country.events],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Detail header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to live feed"
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-base leading-none" aria-label={country.name}>
          {countryFlag(country.code)}
        </span>
        <span className="flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white/90">
          {country.name}
        </span>
        <span
          className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ALERT_LEVEL_BADGE[country.alertLevel]}`}
        >
          {ALERT_LEVEL_LABEL[country.alertLevel]}
        </span>
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
          {country.events.length} event{country.events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Conflict metadata — shown when a known conflict is associated with this country */}
      {country.conflictName && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          {country.conflictStatus && (
            <span
              className={`shrink-0 h-1.5 w-1.5 rounded-full ${CONFLICT_STATUS_DOT[country.conflictStatus]}`}
              aria-hidden="true"
            />
          )}
          <span className="flex-1 truncate text-[10px] font-medium text-gray-600 dark:text-gray-400">
            {country.conflictName}
          </span>
          {country.conflictStatus && (
            <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
              {CONFLICT_STATUS_LABEL[country.conflictStatus]}
            </span>
          )}
        </div>
      )}

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {sortedEvents.length > 0 ? (
          sortedEvents.map((ev, i) => (
            <EventDetailRow key={`${ev.title}-${ev.time}-${i}`} event={ev} />
          ))
        ) : (
          <div className="py-6 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No live events in the current window.
            </p>
            {country.conflictName && (
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                Conflict zone monitored via ACLED · UCDP · CFR · UN OCHA
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── FeedRow ────────────────────────────────────────────────────────────────────
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
      className="flex flex-col gap-1 py-3 border-b border-gray-100 last:border-0 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg px-1 transition-colors"
      style={{ scrollSnapAlign: "start" }}
      onClick={() => onCountryClick(country)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCountryClick(country)}
    >
      {/* Top row: severity dot + country flag/name + time */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`shrink-0 h-2 w-2 rounded-full ${SEVERITY_DOT[event.severity]}`}
          aria-label={event.severity}
        />
        <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 truncate">
          <span aria-label={country.name}>{countryFlag(country.code)}</span>
          <span className="truncate">{country.name}</span>
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
          {relativeTime(event.time)}
        </span>
      </div>
      {/* Headline — bold for readability */}
      <p className="text-sm font-semibold text-gray-800 dark:text-white/90 line-clamp-2 leading-snug">
        {event.title}
      </p>
      {/* Meta row: source · category · read link */}
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="truncate">{event.source}</span>
        <span aria-hidden="true">·</span>
        <span className={`shrink-0 font-medium uppercase ${CATEGORY_BADGE[event.category]}`}>
          {event.category}
        </span>
        {event.link && (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-700/50 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Read article: ${event.title}`}
          >
            Read ↗
          </a>
        )}
      </div>
    </div>
  );
});

/** Hard cap on the "expanded" view (keeps the component from growing unbounded) */
const MAX_ROWS_EXPANDED = 25;

/**
 * Live event feed — shows the most recent events across all countries,
 * newest first.  Clicking a row shows inline country detail (no modal).
 * When `activeCountry` is injected from a parent (e.g. map click), the
 * detail view opens for that country automatically.
 */
export default function LiveEventFeed({
  countries,
  maxRows = 10,
  onCountryClick: _onCountryClick,
  panelMode = false,
  activeCountry,
  onDismissActive,
}: LiveEventFeedProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  // Country selected by clicking a feed row (internal selection)
  const [inlineSelected, setInlineSelected] = useState<CountryNewsData | null>(null);

  // External selection (map click) takes precedence over internal selection.
  // When the parent injects a new activeCountry, clear any internal selection.
  useEffect(() => {
    if (activeCountry) setInlineSelected(null);
  }, [activeCountry]);

  const displayedCountry = activeCountry ?? inlineSelected;

  // Handler for feed row click — shows inline detail instead of calling onCountryClick
  const handleRowClick = useCallback(
    (c: CountryNewsData) => {
      setInlineSelected(c);
    },
    [],
  );

  // Handler for back button in detail view
  const handleBack = useCallback(() => {
    setInlineSelected(null);
    onDismissActive?.();
  }, [onDismissActive]);

  // All events sorted newest-first, capped at MAX_ROWS_EXPANDED
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

  // Apply keyword search then cap to maxRows (collapsed) or MAX_ROWS_EXPANDED (expanded)
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
    return filtered.slice(0, expanded || panelMode ? MAX_ROWS_EXPANDED : maxRows);
  }, [allFeed, search, expanded, maxRows, panelMode]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    if (e.target.value.trim()) setExpanded(true);
  };

  const canExpand = !expanded && !panelMode && allFeed.length > maxRows && !search.trim();

  if (allFeed.length === 0) return null;

  const feedRows = (
    <>
      {feed.length > 0 ? (
        feed.map((entry, idx) => (
          <FeedRow
            key={`${entry.country.code}-${entry.event.time}-${idx}`}
            entry={entry}
            onCountryClick={handleRowClick}
          />
        ))
      ) : (
        <p className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">
          No events match &ldquo;{search}&rdquo;
        </p>
      )}
    </>
  );

  if (panelMode) {
    return (
      <div className="flex flex-col h-full">
        {displayedCountry ? (
          <CountryDetail country={displayedCountry} onBack={handleBack} />
        ) : (
          <>
            {/* Search input */}
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <input
                type="search"
                value={search}
                onChange={handleSearch}
                placeholder="Filter events…"
                aria-label="Filter live feed events"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-brand-500"
              />
            </div>
            {/* Snap-scroll feed list */}
            <div
              className="flex-1 overflow-y-auto px-3 py-1"
              style={{ scrollSnapType: "y mandatory" }}
            >
              {feedRows}
            </div>
          </>
        )}
      </div>
    );
  }

  // Non-panel mode: show detail inline if a country is selected
  if (displayedCountry) {
    return (
      <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 min-h-[200px] flex flex-col">
        <CountryDetail country={displayedCountry} onBack={handleBack} />
      </div>
    );
  }

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
      <div style={{ scrollSnapType: "y mandatory" }}>
        {feedRows}
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
