import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject } from "@react-jvectormap/core/dist/types";
import { worldMill as rawWorldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory, AlertLevel } from "./types";
import { useNewsMap } from "./useNewsMap";
import EventModal from "./EventModal";

// ── Map patch — remove French Guiana from France's SVG path ──────────────────
// The worldMill dataset encodes French Guiana (South America) as a subpath of
// the France (FR) region.  On hover, jVectorMap highlights the entire FR path,
// causing an orange region to appear in South America when the user hovers over
// mainland France — and vice-versa.  We strip the South-American subpath at
// import time so only the two European polygons (mainland + Corsica) remain.
const FRENCH_GUIANA_SUBPATH_START = "M289.01,278.39";
const worldMill = (() => {
  const fr = rawWorldMill.content.paths["FR"] as { path: string; name: string } | undefined;
  if (!fr?.path.includes(FRENCH_GUIANA_SUBPATH_START)) return rawWorldMill;
  const patchedPath = fr.path
    .split(/(?=M)/)
    .filter((seg) => !seg.startsWith(FRENCH_GUIANA_SUBPATH_START))
    .join("");
  return {
    ...rawWorldMill,
    content: {
      ...rawWorldMill.content,
      paths: {
        ...rawWorldMill.content.paths,
        FR: { ...fr, path: patchedPath },
      },
    },
  } as typeof rawWorldMill;
})();

const HOVER_FILL = "#FFD300"; // brand-500 gold — used for hover AND trending region highlight
const LIGHT_DEFAULT_FILL = "#D0D5DD";

/** Default ping colour for all event markers — matches the hover/trending region fill */
const EVENT_PING_FILL = "#FFD300";   // brand-500 gold
/** Ping colour for trending-country markers */
const TRENDING_PING_FILL = "#E5A900"; // brand-600 amber

const REGION_STYLE = {
  initial: { fill: LIGHT_DEFAULT_FILL, fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
  hover: { fillOpacity: 0.7, cursor: "pointer", fill: HOVER_FILL, stroke: "none" },
  selected: { fill: HOVER_FILL },
  selectedHover: { fill: HOVER_FILL, fillOpacity: 0.8 },
} as const;

// Default marker style — individual marker colours are overridden imperatively via addMarker()
const MARKER_STYLE = {
  initial: { fill: EVENT_PING_FILL, stroke: "#ffffff", "stroke-width": 1.5, r: 4 },
  hover: { stroke: HOVER_FILL, cursor: "pointer" },
  selected: {},
  selectedHover: {},
};

const REGION_LABEL_STYLE = {
  initial: { fill: "#35373e", fontWeight: 500, fontSize: "13px", stroke: "none" },
  hover: {}, selected: {}, selectedHover: {},
} as const;

/** Convert an ISO-3166-1 alpha-2 country code to a flag emoji.
 *  Returns an empty string for invalid codes (non-alpha or wrong length). */
function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2 || !/^[A-Z]{2}$/.test(upper)) return "";
  return [...upper].map((c) =>
    String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)
  ).join("");
}

type CategoryFilter = "all" | EventCategory;

const FILTER_LABELS: Record<CategoryFilter, string> = {
  all:        "All",
  violent:    "Violent",
  economic:   "Economic",
  minor:      "Minor",
  extremism:  "Extremism",
  escalation: "Escalation",
};

/**
 * Isolated VectorMap that never re-renders after mount.
 * @react-jvectormap spreads all props into its useLayoutEffect dependency array,
 * so ANY prop change causes a full jVectorMap reinitialisation (wiping imperative
 * state). React.memo with stable prop references prevents this.
 */
const StableMap = memo(function StableMap({
  mapRef,
  onRegionClick,
  onRegionTipShow,
}: {
  mapRef: React.MutableRefObject<IMapObject | null>;
  onRegionClick: (e: Event, code: string) => void;
  onRegionTipShow: (e: Event) => void;
}) {
  return (
    <VectorMap
      map={worldMill}
      mapRef={mapRef}
      backgroundColor="transparent"
      zoomOnScroll={false}
      zoomMax={12}
      zoomMin={1}
      zoomAnimate={true}
      zoomStep={1.5}
      markersSelectable={false}
      // `as any` needed: @react-jvectormap type definitions are narrower than
      // the actual jVectorMap runtime interface (missing overloads / `const`
      // object compatibility).  No runtime impact.
      onRegionClick={onRegionClick as any}
      onRegionTipShow={onRegionTipShow as any}
      regionStyle={REGION_STYLE as any}
      regionLabelStyle={REGION_LABEL_STYLE as any}
      markerStyle={MARKER_STYLE as any}
    />
  );
});

export default function NewsMapWidget() {
  const { data, loading } = useNewsMap();
  const [selected, setSelected] = useState<CountryNewsData | null>(null);
  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const mapRef = useRef<IMapObject | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Keep latest country lookup in a ref so the stable handler can access it
  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

  // Track previously highlighted codes so paintRegions only touches changed paths
  const prevHighlightedRef = useRef<Set<string>>(new Set());

  const allCountries = useMemo(() => data?.countries ?? [], [data]);

  // Compute which categories have at least one live event
  const activeCategories = useMemo<Set<CategoryFilter>>(() => {
    const cats = new Set<CategoryFilter>(["all"]);
    for (const c of allCountries) {
      for (const e of c.events) cats.add(e.category as CategoryFilter);
    }
    return cats;
  }, [allCountries]);

  // If the selected filter no longer has any events, fall back to "all"
  useEffect(() => {
    if (categoryFilter !== "all" && !activeCategories.has(categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [activeCategories, categoryFilter, setCategoryFilter]);

  // Filter countries to those that have at least one event matching the active filter
  const countries = useMemo(() => {
    if (categoryFilter === "all") return allCountries;
    return allCountries
      .map((c) => ({
        ...c,
        events: c.events.filter((e) => e.category === categoryFilter),
      }))
      .filter((c) => c.events.length > 0);
  }, [allCountries, categoryFilter]);

  const trendingCountries = useMemo(
    () => countries
      .filter((c) => c.trending)
      .sort((a, b) => (a.trendingRank ?? 99) - (b.trendingRank ?? 99)),
    [countries]
  );

  const trendingCodes = useMemo(
    () => trendingCountries.map((c) => c.code),
    [trendingCountries]
  );

  countryByCodeRef.current = useMemo(
    () => new Map(countries.map((c) => [c.code, c])),
    [countries]
  );

  // Stable — never recreated, so StableMap never re-renders
  const handleRegionClick = useCallback((_e: Event, code: string) => {
    const upperCode = code.toUpperCase();
    const country = countryByCodeRef.current.get(upperCode);
    if (country) {
      setSelected(country);
      setTappedCode(upperCode);
    }
  }, []);

  // Suppress jVectorMap's built-in region tooltips — the widget uses click-based
  // modals instead, and the default tooltip causes confusion for multi-polygon
  // regions (e.g. it would otherwise float over the wrong continent).
  const handleRegionTipShow = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // Stable close handler — clears both the modal and the tap highlight
  const handleClose = useCallback(() => {
    setSelected(null);
    setTappedCode(null);
  }, []);

  // Open modal for a country and highlight it on the map (used by trending pills)
  const handlePillClick = useCallback((country: CountryNewsData) => {
    setSelected(country);
    setTappedCode(country.code);
  }, []);

  // ── Desktop zoom controls ───────────────────────────────────────────────────
  // jVectorMap's `setFocus({ scale })` without position params corrupts transX/transY
  // to undefined when animating.  We call `setScale` directly — the same approach used
  // by jVectorMap's own built-in +/- buttons — anchoring at the viewport centre.
  const mapSetScale = useCallback((newScale: number) => {
    const map = mapRef.current;
    if (!map) return;
    const raw = map as unknown as Record<string, unknown>;
    const w = typeof raw.width  === "number" ? raw.width  : 0;
    const h = typeof raw.height === "number" ? raw.height : 0;
    if (typeof raw.setScale === "function") {
      (raw.setScale as (s: number, x: number, y: number, c: boolean, a: boolean) => void)(
        newScale, w / 2, h / 2, false, true
      );
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const raw = map as unknown as Record<string, unknown>;
    const cur = typeof raw.scale === "number" ? raw.scale : 1;
    const base = typeof raw.baseScale === "number" ? raw.baseScale : 1;
    mapSetScale(Math.min(cur * 1.5, 12 * base));
  }, [mapSetScale]);

  const handleZoomOut = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const raw = map as unknown as Record<string, unknown>;
    const cur = typeof raw.scale === "number" ? raw.scale : 1;
    const base = typeof raw.baseScale === "number" ? raw.baseScale : 1;
    mapSetScale(Math.max(cur / 1.5, 1 * base));
  }, [mapSetScale]);

  const handleZoomReset = useCallback(() => {
    mapRef.current?.reset();
  }, []);

  /**
   * Delta-paint jVectorMap region fills using inline styles.
   *
   * jVectorMap sets fills via SVG `fill` *attributes*, which lose to CSS
   * property rules in the cascade. Inline styles win without !important hacks.
   *
   * Instead of scanning all ~300 region paths on every change, we use the
   * `data-code` attribute (set by jVectorMap on every region path) to target
   * only the codes that changed between renders:
   *   - Newly highlighted codes → set fill: HOVER_FILL !important
   *   - Newly de-highlighted codes → remove inline fill (CSS restores the
   *     correct default via .fill-gray-300 / dark:.fill-gray-700 classes)
   *
   * CSS dark-mode classes (.dark\:fill-gray-700) handle non-highlighted
   * regions' theme-aware default fill automatically, so theme changes require
   * no extra DOM work here.
   */
  const paintRegions = useCallback((toHighlight: string[]) => {
    const container = mapContainerRef.current;
    if (!container) return;
    const newSet = new Set(toHighlight);
    const prevSet = prevHighlightedRef.current;
    const added   = toHighlight.filter((c) => !prevSet.has(c));
    const removed = [...prevSet].filter((c) => !newSet.has(c));
    for (const code of added) {
      container.querySelectorAll<SVGPathElement>(`[data-code="${code}"]`)
        .forEach((el) => el.style.setProperty("fill", HOVER_FILL, "important"));
    }
    for (const code of removed) {
      container.querySelectorAll<SVGPathElement>(`[data-code="${code}"]`)
        .forEach((el) => el.style.removeProperty("fill"));
    }
    prevHighlightedRef.current = newSet;
  }, []);

  // Update selected regions via jVectorMap's own API, then delta-paint inline
  // styles to win the CSS cascade for highlighted regions.
  // theme is intentionally omitted: CSS dark-mode classes handle non-highlighted
  // regions automatically, so a theme change needs no DOM work here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.clearSelectedRegions();
    const toSelect = tappedCode ? [...trendingCodes, tappedCode] : trendingCodes;
    if (toSelect.length > 0) map.setSelectedRegions(toSelect);
    paintRegions(toSelect);
  }, [trendingCodes, tappedCode, paintRegions]);

  // Sync ping markers imperatively so they are rendered inside jVectorMap's SVG
  // and move correctly with the map when the user zooms or pans on mobile.
  // removeAllMarkers + re-add is the safest approach given jVectorMap's API.
  // Trending country markers are shown in a lighter terra cotta; all other events use the default fill.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || countries.length === 0) return;
    map.removeAllMarkers();
    countries.forEach((country) => {
      const isTrending = country.trending;
      map.addMarker(
        country.code,
        {
          name: country.name,
          latLng: [country.lat, country.lng],
          style: {
            fill: isTrending ? TRENDING_PING_FILL : EVENT_PING_FILL,
            stroke: "#ffffff",
            r: isTrending ? 6 : 4,
          } as React.CSSProperties,
        },
        []
      );
    });
  }, [countries]);

  const totalEvents = useMemo(
    () => countries.reduce((sum, c) => sum + c.events.length, 0),
    [countries]
  );

  /** Count of countries at each alert level — shown in the footer summary */
  const alertCounts = useMemo(() => {
    const counts: Record<AlertLevel, number> = { critical: 0, high: 0, medium: 0, watch: 0 };
    for (const c of countries) counts[(c.alertLevel ?? "watch") as AlertLevel]++;
    return counts;
  }, [countries]);



  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            6
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Global News Map
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Category filter tabs — only shown when that category has live events */}
          {(Object.keys(FILTER_LABELS) as CategoryFilter[])
            .filter((f) => activeCategories.has(f))
            .map((f) => (
            <button
              key={f}
              onClick={() => setCategoryFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                categoryFilter === f
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
          {loading && (
            <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Updating…</span>
          )}
        </div>
      </div>

      {/* Map container */}
      <div className="relative overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div ref={mapContainerRef} className="h-[420px] sm:h-[520px] xl:h-[620px]">
          <StableMap mapRef={mapRef} onRegionClick={handleRegionClick} onRegionTipShow={handleRegionTipShow} />
        </div>

        {!loading && countries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400 dark:text-gray-500">No events detected</p>
          </div>
        )}

        {/* Desktop zoom controls — hidden on mobile where pinch-to-zoom is native */}
        <div className="absolute bottom-3 right-3 z-10 hidden sm:flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition-all hover:border-gray-300 hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/90 dark:hover:border-gray-600 dark:hover:bg-gray-700"
          >
            <svg className="h-4 w-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4M11 8v6M8 11h6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={handleZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition-all hover:border-gray-300 hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/90 dark:hover:border-gray-600 dark:hover:bg-gray-700"
          >
            <svg className="h-4 w-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4M8 11h6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={handleZoomReset}
            aria-label="Reset view"
            title="Reset view"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition-all hover:border-gray-300 hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/90 dark:hover:border-gray-600 dark:hover:bg-gray-700"
          >
            <svg className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {data && (
        <div className="mt-3 space-y-2">
          {/* Row 1: count summary + timestamp */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {countries.length} countr{countries.length !== 1 ? "ies" : "y"} · {totalEvents} event{totalEvents !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Updated {new Date(data.lastUpdated).toLocaleTimeString()}
              {data.usingMockData && " · demo data"}
            </span>
          </div>

          {/* Row 2: alert-level key + trending pills (only when content exists) */}
          {(alertCounts.critical > 0 || alertCounts.high > 0 || alertCounts.medium > 0 ||
            trendingCountries.length > 0) && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Alert-level badges */}
              {(["critical", "high", "medium"] as AlertLevel[]).some((l) => alertCounts[l] > 0) && (
                <div className="flex items-center gap-2">
                  {(["critical", "high", "medium"] as AlertLevel[]).map((level) =>
                    alertCounts[level] > 0 ? (
                      <span key={level} className="inline-flex items-center gap-1 text-xs font-medium">
                        <span
                          className={`inline-flex h-2 w-2 rounded-full ${
                            level === "critical" ? "bg-error-500 animate-pulse" :
                            level === "high"     ? "bg-warning-500" :
                                                  "bg-brand-500"
                          }`}
                        />
                        <span className="text-gray-500 dark:text-gray-400">
                          {alertCounts[level]} {level}
                        </span>
                      </span>
                    ) : null
                  )}
                </div>
              )}

              {/* Separator between alert badges and trending pills */}
              {(alertCounts.critical > 0 || alertCounts.high > 0 || alertCounts.medium > 0) &&
                trendingCountries.length > 0 && (
                <span className="text-gray-200 dark:text-gray-700" aria-hidden="true">|</span>
              )}

              {/* Trending section — all trending countries as individual ranked pills */}
              {trendingCountries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    Trending
                  </span>
                  {trendingCountries.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => handlePillClick(c)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-error-500/30 bg-error-500/10 px-2 py-0.5 text-xs font-medium text-error-700 transition-colors hover:bg-error-500/20 dark:bg-error-500/20 dark:text-error-400 dark:hover:bg-error-500/30"
                    >
                      {c.trendingRank !== undefined && (
                        <span
                          className="shrink-0 font-bold underline text-error-800 dark:text-error-300"
                          aria-label={`Rank ${c.trendingRank}`}
                        >
                          #{c.trendingRank}
                        </span>
                      )}
                      <span aria-label={c.name}>{countryFlag(c.code)}</span>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <EventModal country={selected} onClose={handleClose} />
    </div>
  );
}
