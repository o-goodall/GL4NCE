import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject } from "@react-jvectormap/core/dist/types";
import { worldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory } from "./types";
import { useNewsMap } from "./useNewsMap";
import EventModal from "./EventModal";

const HOVER_FILL = "#465fff";
const PING_DEFAULT = "#ffffff";
const PING_TRENDING = "#f04438";

const REGION_STYLE = {
  initial: { fill: "#D0D5DD", fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
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
}: {
  mapRef: React.MutableRefObject<IMapObject | null>;
  onRegionClick: (e: Event, code: string) => void;
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

  // Keep latest country lookup in a ref so the stable handler can access it
  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

  const allCountries = data?.countries ?? [];

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

  const trendingCodes = useMemo(
    () => countries.filter((c) => c.trending).map((c) => c.code),
    [countries]
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

  // Stable close handler — clears both the modal and the tap highlight
  const handleClose = useCallback(() => {
    setSelected(null);
    setTappedCode(null);
  }, []);

  // Update selected regions via jVectorMap's own API.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.clearSelectedRegions();
    const toSelect = tappedCode ? [...trendingCodes, tappedCode] : trendingCodes;
    if (toSelect.length > 0) map.setSelectedRegions(toSelect);
  }, [trendingCodes, tappedCode]);

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
          {/* Category filter tabs */}
          {(Object.keys(FILTER_LABELS) as CategoryFilter[]).map((f) => (
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
        <div className="h-[300px] sm:h-[360px] xl:h-[420px]">
          <StableMap mapRef={mapRef} onRegionClick={handleRegionClick} />
        </div>

        {!loading && countries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400 dark:text-gray-500">No events detected</p>
          </div>
        )}
      </div>

      {data && (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          {countries.length} countr{countries.length !== 1 ? "ies" : "y"} · {totalEvents} event{totalEvents !== 1 ? "s" : ""} ·{" "}
          {trendingCodes.length} trending ·{" "}
          Updated {new Date(data.lastUpdated).toLocaleTimeString()}
          {data.usingMockData && " · demo data"}
        </p>
      )}

      <EventModal country={selected} onClose={handleClose} />
    </div>
  );
}
