import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject } from "@react-jvectormap/core/dist/types";
import { worldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory } from "./types";
import { latLngToPercent } from "./countryData";
import { useNewsMap } from "./useNewsMap";
import EventModal from "./EventModal";

const CATEGORY_COLOURS: Record<EventCategory, string> = {
  violent: "#f04438",
  minor: "#f79009",
  economic: "#0ba5ec",
};

const TRENDING_FILL = "#f04438";

const REGION_STYLE = {
  initial: { fill: "#D0D5DD", fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
  hover: { fillOpacity: 0.7, cursor: "pointer", fill: "#465fff", stroke: "none" },
  selected: { fill: TRENDING_FILL },
  selectedHover: { fill: TRENDING_FILL, fillOpacity: 0.7 },
} as const;

const REGION_LABEL_STYLE = {
  initial: { fill: "#35373e", fontWeight: 500, fontSize: "13px", stroke: "none" },
  hover: {}, selected: {}, selectedHover: {},
} as const;

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
    />
  );
});

function dominantCategory(country: CountryNewsData): EventCategory {
  const counts: Record<EventCategory, number> = { violent: 0, minor: 0, economic: 0 };
  for (const ev of country.events) counts[ev.category]++;
  return (["violent", "economic", "minor"] as EventCategory[]).find(
    (c) => counts[c] === Math.max(...Object.values(counts))
  ) ?? "minor";
}

const HOVER_FILL = "#465fff";

export default function NewsMapWidget() {
  const { data, loading } = useNewsMap();
  const [selected, setSelected] = useState<CountryNewsData | null>(null);
  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const mapRef = useRef<IMapObject | null>(null);

  // Keep latest country lookup in a ref so the stable handler can access it
  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

  const countries = data?.countries ?? [];
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

  // Push trending colour updates and tap highlight imperatively.
  // Combined into one effect to avoid a race where the trending effect
  // overwrites the tap highlight applied by a separate effect.
  // Dual approach: direct SVG fill for immediate visual update +
  // jVectorMap API call so hover-out restores the correct colour.
  useEffect(() => {
    const trendingSet = new Set(trendingCodes);

    // 1. Direct DOM fill (bypasses any timing issue with mapRef).
    //    If a region is currently tapped (mobile touch feedback), apply
    //    the hover colour so the user sees which country they selected.
    const container = document.querySelector(".jvectormap-container");
    if (container) {
      container.querySelectorAll<SVGPathElement>(".jvectormap-region").forEach((el) => {
        const code = el.getAttribute("data-code");
        if (code) {
          if (code === tappedCode) {
            el.setAttribute("fill", HOVER_FILL);
          } else {
            el.setAttribute("fill", trendingSet.has(code) ? TRENDING_FILL : "#D0D5DD");
          }
        }
      });
    }

    // 2. jVectorMap selection — keeps hover-out behaviour consistent
    const map = mapRef.current;
    if (map) {
      map.clearSelectedRegions();
      if (trendingCodes.length > 0) map.setSelectedRegions(trendingCodes);
    }
  }, [trendingCodes, tappedCode]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            6
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Global News Map
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {(["violent", "economic", "minor"] as EventCategory[]).map((cat) => (
            <span key={cat} className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOURS[cat] }} />
              {cat}
            </span>
          ))}
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TRENDING_FILL }} />
            trending
          </span>
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

        {/* Category-coloured ping dots (visual indicators, no interaction) */}
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
          aria-hidden="true"
        >
          {countries.map((country) => {
            const { x, y } = latLngToPercent(country.lat, country.lng);
            return (
              <circle
                key={country.code}
                cx={`${x}%`}
                cy={`${y}%`}
                r="4"
                fill={CATEGORY_COLOURS[dominantCategory(country)]}
                stroke="white"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        {!loading && countries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400 dark:text-gray-500">No events detected</p>
          </div>
        )}
      </div>

      {data && (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          {countries.length} countr{countries.length !== 1 ? "ies" : "y"} with recent events ·{" "}
          {trendingCodes.length} trending ·{" "}
          Updated {new Date(data.lastUpdated).toLocaleTimeString()}
        </p>
      )}

      <EventModal country={selected} onClose={handleClose} />
    </div>
  );
}
