import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject, ISVGElementStyleAttributes, IVectorMapProps } from "@react-jvectormap/core/dist/types";
import { worldMill as rawWorldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";
import { useNewsMap } from "./useNewsMap";
import EventModal from "./EventModal";
import LiveEventFeed from "./LiveEventFeed";

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

/** Marker fill colour keyed by alert level — matches the legend dots in the footer */
const ALERT_LEVEL_MARKER_FILL: Record<string, string> = {
  critical: "#F04438", // error-500 red
  high:     "#F79009", // warning-500 orange
  medium:   "#FFD300", // brand-500 gold
  watch:    "#98A2B3", // gray-400
};

/** Marker radius (px in SVG units) keyed by alert level */
const ALERT_LEVEL_MARKER_RADIUS: Record<string, number> = {
  critical: 7,
  high:     6,
  medium:   5,
  watch:    4,
};

const REGION_STYLE: ISVGElementStyleAttributes = {
  initial: { fill: LIGHT_DEFAULT_FILL, fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
  hover: { fillOpacity: 0.7, cursor: "pointer", fill: HOVER_FILL, stroke: "none" },
  selected: { fill: HOVER_FILL },
  selectedHover: { fill: HOVER_FILL, fillOpacity: 0.8 },
};

// Default marker style — individual marker colours and radii are overridden per-marker via addMarker()
const MARKER_STYLE: ISVGElementStyleAttributes = {
  initial: { fill: ALERT_LEVEL_MARKER_FILL.medium, stroke: "#ffffff", strokeWidth: 1.5 },
  hover: { stroke: HOVER_FILL, cursor: "pointer" },
  selected: {},
  selectedHover: {},
};

const REGION_LABEL_STYLE: ISVGElementStyleAttributes = {
  initial: { fill: "#35373e", fontWeight: 500, fontSize: "13px", stroke: "none" },
  hover: {}, selected: {}, selectedHover: {},
};

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
      // `as unknown as` needed: @react-jvectormap type definitions reference
      // JQuery.Event which is not available as a direct dependency; the actual
      // runtime callbacks are fully compatible at the call site.
      onRegionClick={onRegionClick as unknown as IVectorMapProps["onRegionClick"]}
      onRegionTipShow={onRegionTipShow as unknown as IVectorMapProps["onRegionTipShow"]}
      regionStyle={REGION_STYLE}
      regionLabelStyle={REGION_LABEL_STYLE}
      markerStyle={MARKER_STYLE}
    />
  );
});

/** Alert levels that can be toggled off; "all" means no restriction */
type AlertFilter = AlertLevel | "all";

export default function NewsMapWidget() {
  const { data, loading } = useNewsMap();
  const [selected, setSelected] = useState<CountryNewsData | null>(null);
  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [showZoomHint, setShowZoomHint] = useState(false);
  const mapRef = useRef<IMapObject | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Filter countries: first by category, then by alert level
  const countries = useMemo(() => {
    let result = allCountries;
    if (categoryFilter !== "all") {
      result = result
        .map((c) => ({
          ...c,
          events: c.events.filter((e) => e.category === categoryFilter),
        }))
        .filter((c) => c.events.length > 0);
    }
    if (alertFilter !== "all") {
      result = result.filter((c) => c.alertLevel === alertFilter);
    }
    return result;
  }, [allCountries, categoryFilter, alertFilter]);

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

  // ── Trackpad / pinch-to-zoom ────────────────────────────────────────────────
  // Browsers synthesise a wheel event with ctrlKey=true for trackpad pinch
  // gestures, which is the same signal sent by Ctrl+scroll on a mouse.
  // We intercept this on the container and apply zoom toward the cursor
  // position rather than the viewport centre (more natural on large maps).
  // Plain scroll (without Ctrl / pinch) shows a brief hint overlay instead
  // of accidentally zooming the map while the user scrolls the page.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Regular scroll — briefly surface a hint; do NOT prevent default so
        // the page continues to scroll normally.
        setShowZoomHint(true);
        if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
        zoomHintTimerRef.current = setTimeout(() => setShowZoomHint(false), 1800);
        return;
      }
      // Pinch or Ctrl+scroll — zoom the map toward the cursor position.
      // Square-root-scale deltaY so trackpad pinch (|deltaY|≈3–5 → √≈0.17–0.22)
      // produces a noticeable ~4–6 % step per frame, while mouse Ctrl+scroll
      // (|deltaY|≈100 → √=1.0) still produces the full 25 % step.
      // Clamping to 100 prevents a single over-sized event from jumping too far.
      e.preventDefault();
      const map = mapRef.current;
      if (!map) return;
      const raw = map as unknown as Record<string, unknown>;
      const cur  = typeof raw.scale     === "number" ? raw.scale     : 1;
      const base = typeof raw.baseScale === "number" ? raw.baseScale : 1;
      const normalised = Math.sqrt(Math.min(Math.abs(e.deltaY), 100) / 100); // √-scaled: boosts small trackpad deltas
      const zoomChange = normalised * 0.25;                                   // up to 25%
      const factor = e.deltaY < 0 ? 1 + zoomChange : 1 / (1 + zoomChange);
      const newScale = Math.min(Math.max(cur * factor, base), 12 * base);
      if (typeof raw.setScale === "function") {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        (raw.setScale as (s: number, x: number, y: number, c: boolean, a: boolean) => void)(
          newScale, x, y, false, true
        );
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    };
  }, []); // only runs once — uses refs throughout, no reactive deps

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
  // Marker colour and radius vary by alertLevel; critical markers get an
  // expanding "ping ring" ghost circle (same effect as the notification bell).
  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    // Remove previously injected ping-ring ghost circles before re-syncing
    container.querySelectorAll<SVGCircleElement>(".map-ping-ring").forEach((el) => el.remove());

    map.removeAllMarkers();
    if (countries.length === 0) return;

    countries.forEach((country) => {
      const alertLevel = country.alertLevel ?? "watch";
      const fill = ALERT_LEVEL_MARKER_FILL[alertLevel] ?? ALERT_LEVEL_MARKER_FILL.watch;
      const r = (ALERT_LEVEL_MARKER_RADIUS[alertLevel] ?? ALERT_LEVEL_MARKER_RADIUS.watch) + (country.trending ? 1 : 0);

      map.addMarker(
        country.code,
        {
          name: country.name,
          latLng: [country.lat, country.lng],
          style: {
            fill,
            stroke: "#ffffff",
            "stroke-width": 1.5,
            r,
          } as React.CSSProperties,
        },
        []
      );

      // Inject an expanding ping-ring for critical markers, matching the
      // notification-bell animate-ping pattern: a ghost circle that expands
      // and fades while the main circle stays static.
      if (alertLevel === "critical") {
        container.querySelectorAll<SVGCircleElement>(`[data-index="${country.code}"]`).forEach((markerEl) => {
          const cx = markerEl.getAttribute("cx") ?? "0";
          const cy = markerEl.getAttribute("cy") ?? "0";
          const parent = markerEl.parentElement;
          if (parent) {
            const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            ring.setAttribute("cx", cx);
            ring.setAttribute("cy", cy);
            ring.setAttribute("r", String(r));
            ring.setAttribute("fill", fill);
            ring.setAttribute("pointer-events", "none");
            ring.classList.add("map-ping-ring");
            ring.dataset.country = country.code;
            // Insert before the main circle so the ring renders underneath it
            parent.insertBefore(ring, markerEl);
          }
        });
      }
    });

    // jVectorMap calls repositionMarkers() on every zoom/pan, which updates
    // the cx/cy attributes of marker circles directly rather than transforming
    // their parent group.  The ping rings have static cx/cy captured at
    // creation time and therefore drift away from their markers on zoom.
    // A MutationObserver watching each marker's cx/cy attribute fixes this
    // without hooking into jVectorMap internals.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target as Element;
        const code = target.getAttribute("data-index");
        if (!code) continue;
        const ring = container.querySelector<SVGCircleElement>(
          `.map-ping-ring[data-country="${code}"]`
        );
        if (!ring) continue;
        const cx = target.getAttribute("cx");
        const cy = target.getAttribute("cy");
        if (cx !== null) ring.setAttribute("cx", cx);
        if (cy !== null) ring.setAttribute("cy", cy);
      }
    });

    container
      .querySelectorAll<Element>("[data-index]")
      .forEach((markerEl) => {
        observer.observe(markerEl, { attributes: true, attributeFilter: ["cx", "cy"] });
      });

    return () => observer.disconnect();
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
                  ? "bg-brand-500 text-gray-900"
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

        {/* Pinch / Ctrl+scroll zoom hint — briefly shown when user scrolls without pinching */}
        {showZoomHint && (
          <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-20">
            <div className="rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
              Pinch or Ctrl + scroll to zoom
            </div>
          </div>
        )}

        {/* Map legend — floating bottom-left; each row is a clickable filter toggle.
             Active filter: that alert level only. Click again to clear.
             Inspired by liveuamap's layer-toggle controls. */}
        <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-gray-200/80 bg-white/90 px-2.5 py-1.5 backdrop-blur-sm shadow-sm dark:border-gray-700/80 dark:bg-gray-800/90">
          <div className="flex flex-col gap-1">
            {(["critical", "high", "medium", "watch"] as AlertLevel[]).map((level) => {
              const isActive = alertFilter === level;
              const isDimmed = alertFilter !== "all" && alertFilter !== level;
              return (
                <button
                  key={level}
                  onClick={() => setAlertFilter(isActive ? "all" : level)}
                  title={isActive ? `Show all alert levels` : `Filter to ${level} only`}
                  aria-pressed={isActive}
                  className={`flex items-center gap-1.5 rounded px-0.5 py-0.5 text-left transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    isDimmed ? "opacity-30" : "opacity-100"
                  } ${isActive ? "ring-1 ring-brand-400 ring-offset-1 dark:ring-offset-gray-800" : ""}`}
                >
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: ALERT_LEVEL_MARKER_RADIUS[level] * 2,
                      height: ALERT_LEVEL_MARKER_RADIUS[level] * 2,
                      backgroundColor: ALERT_LEVEL_MARKER_FILL[level],
                      border: "1.5px solid #ffffff",
                      display: "inline-block",
                    }}
                    aria-hidden="true"
                  />
                  <span className={`text-[10px] capitalize leading-none ${isActive ? "font-semibold text-gray-800 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>
                    {level}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

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
              {data.feedStats && ` · ${data.feedStats.succeeded}/${data.feedStats.total} sources`}
              {data.usingMockData && " · demo data"}
            </span>
          </div>

          {/* Row 2: alert-level key + trending pills + conflict groups */}
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

          {/* Row 3: Active conflict groups — sourced from API's conflictGroups field.
               The API already detects when trending countries are part of known conflict
               pairs (e.g. Russia–Ukraine, Israel–Iran).  We surface those here so users
               can see at a glance which crises are interconnected.  Each group is rendered
               as a compact pill showing the two (or more) involved flags + country names. */}
          {data.conflictGroups && data.conflictGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                Active conflicts
              </span>
              {data.conflictGroups.map((group) => {
                const members = group
                  .map((code) => countryByCodeRef.current.get(code))
                  .filter((c): c is CountryNewsData => c !== undefined);
                if (members.length < 2) return null;
                return (
                  <span
                    key={group.join("-")}
                    className="inline-flex items-center gap-0.5 rounded-full border border-warning-500/30 bg-warning-500/10 px-2 py-0.5 text-xs font-medium text-warning-800 dark:bg-warning-500/20 dark:text-warning-300"
                    title={`Active conflict: ${members.map((m) => m.name).join(" vs ")}`}
                  >
                    {members.map((m, i) => (
                      <span key={m.code}>
                        {i > 0 && <span className="text-warning-500/60 mx-0.5">vs</span>}
                        <button
                          className="hover:underline"
                          onClick={() => handlePillClick(m)}
                        >
                          {countryFlag(m.code)} {m.name}
                        </button>
                      </span>
                    ))}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Live event feed — shows the most recent events across all active countries,
           newest first.  Inspired by liveuamap's real-time event ticker and
           globalthreatmap's event feed panel: both surfaces individual events
           chronologically to give a live operational picture beyond per-country
           aggregates.  Clicking any row opens that country's detail modal. */}
      {data && countries.length > 0 && (
        <LiveEventFeed
          countries={countries}
          maxRows={10}
          onCountryClick={handlePillClick}
        />
      )}

      <EventModal country={selected} onClose={handleClose} />
    </div>
  );
}
