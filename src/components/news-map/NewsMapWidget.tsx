import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject } from "@react-jvectormap/core/dist/types";
import { worldMill as rawWorldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory } from "./types";
import { useNewsMap } from "./useNewsMap";
import EventModal from "./EventModal";
import { useTheme } from "../../context/ThemeContext";

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

const HOVER_FILL = "#F7931A";
const DARK_DEFAULT_FILL = "#344054";
const LIGHT_DEFAULT_FILL = "#D0D5DD";
const PING_DEFAULT = "#ffffff";
const PING_TRENDING = "#f04438";

const REGION_STYLE = {
  initial: { fill: LIGHT_DEFAULT_FILL, fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
  hover: { fillOpacity: 0.7, cursor: "pointer", fill: HOVER_FILL, stroke: "none" },
  selected: { fill: HOVER_FILL },
  selectedHover: { fill: HOVER_FILL, fillOpacity: 0.8 },
} as const;

// Default marker style — individual marker colours are set imperatively via addMarker()
const MARKER_STYLE = {
  initial: { fill: PING_DEFAULT, stroke: "#667085", "stroke-width": 1.5, r: 4 },
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
  all:       "All",
  violent:   "Violent",
  economic:  "Economic",
  minor:     "Minor",
  extremism: "Extremism",
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
  const { theme } = useTheme();
  const [selected, setSelected] = useState<CountryNewsData | null>(null);
  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const mapRef = useRef<IMapObject | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Keep latest country lookup in a ref so the stable handler can access it
  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

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
    () => countries.filter((c) => c.trending),
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

  /**
   * Paint all jVectorMap region SVG paths with the correct fill using inline
   * styles. jVectorMap sets fills via the SVG `fill` *attribute*, which CSS
   * class rules can override because CSS properties beat SVG presentation
   * attributes in the cascade. Setting fill via element.style (inline style)
   * wins over class-based CSS rules without requiring !important hacks.
   *
   * We read jVectorMap's own fill *attribute* as ground truth: after
   * setSelectedRegions() the selected paths have fill=HOVER_FILL, others
   * have the initial fill.  We then mirror those values as inline styles.
   * Scoped to the specific map container to avoid interfering with other maps.
   */
  const paintRegions = useCallback((isDark: boolean) => {
    const container = mapContainerRef.current;
    if (!container) return;
    const defaultFill = isDark ? DARK_DEFAULT_FILL : LIGHT_DEFAULT_FILL;
    container
      .querySelectorAll<SVGPathElement>(".jvectormap-region.jvectormap-element")
      .forEach((el) => {
        el.style.fill =
          el.getAttribute("fill") === HOVER_FILL ? HOVER_FILL : defaultFill;
      });
  }, []);

  // Update selected regions via jVectorMap's own API, then force-paint inline
  // styles to override any CSS cascade issues.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.clearSelectedRegions();
    const toSelect = tappedCode ? [...trendingCodes, tappedCode] : trendingCodes;
    if (toSelect.length > 0) map.setSelectedRegions(toSelect);
    // jVectorMap has now updated fill *attributes*; paint inline styles on top.
    paintRegions(theme === "dark");
  }, [trendingCodes, tappedCode, theme, paintRegions]);

  // Sync ping markers imperatively so they are rendered inside jVectorMap's SVG
  // and move correctly with the map when the user zooms or pans on mobile.
  // removeAllMarkers + re-add is the safest approach given jVectorMap's API.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || countries.length === 0) return;
    map.removeAllMarkers();
    countries.forEach((country) => {
      map.addMarker(
        country.code,
        {
          name: country.name,
          latLng: [country.lat, country.lng],
          style: {
            fill: country.trending ? PING_TRENDING : PING_DEFAULT,
            stroke: country.trending ? "#ffffff" : "#667085",
            r: country.trending ? 6 : 4,
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

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
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
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
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
        <div ref={mapContainerRef} className="h-[300px] sm:h-[360px] xl:h-[420px]">
          <StableMap mapRef={mapRef} onRegionClick={handleRegionClick} onRegionTipShow={handleRegionTipShow} />
        </div>

        {!loading && countries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400 dark:text-gray-500">No events detected</p>
          </div>
        )}
      </div>

      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {countries.length} countr{countries.length !== 1 ? "ies" : "y"} · {totalEvents} event{totalEvents !== 1 ? "s" : ""}
          </span>
          {trendingCountries.length > 0 && (
            <>
              <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {trendingCountries.map((c) => (
                  <span
                    key={c.code}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 border border-brand-500/20"
                  >
                    <span aria-label={c.name}>{countryFlag(c.code)}</span>
                    {c.name}
                  </span>
                ))}
              </div>
            </>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
            Updated {new Date(data.lastUpdated).toLocaleTimeString()}
            {data.usingMockData && " · demo data"}
          </span>
        </div>
      )}

      <EventModal country={selected} onClose={handleClose} />
    </div>
  );
}
