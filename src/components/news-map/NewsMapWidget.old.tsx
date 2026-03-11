import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { VectorMap } from "@react-jvectormap/core";
import type { IMapObject, ISVGElementStyleAttributes, IVectorMapProps } from "@react-jvectormap/core/dist/types";
import { worldMill as rawWorldMill } from "@react-jvectormap/world";
import type { CountryNewsData, EventCategory, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";
import { useNewsMap } from "./useNewsMap";
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
  critical: 5,
  high:     4,
  medium:   3.5,
  watch:    3,
};

const REGION_STYLE: ISVGElementStyleAttributes = {
  initial: { fill: LIGHT_DEFAULT_FILL, fillOpacity: 1, stroke: "none", strokeWidth: 0, strokeOpacity: 0 },
  hover: { cursor: "pointer", stroke: "none" },
  selected: { fill: HOVER_FILL },
  selectedHover: { fill: HOVER_FILL, fillOpacity: 0.9 },
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
  all:            "All",
  violent:        "Conflict",
  terrorism:      "Terrorism",
  military:       "Military",
  escalation:     "Escalation",
  diplomatic:     "Diplomatic",
  extremism:      "Extremism",
  economic:       "Economic",
  commodities:    "Commodities",
  cyber:          "Cyber",
  health:         "Health",
  environmental:  "Environmental",
  disaster:       "Disaster",
  infrastructure: "Infrastructure",
  crime:          "Crime",
  piracy:         "Piracy",
  protest:        "Protest",
  minor:          "Minor",
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
  onMarkerClick,
}: {
  mapRef: React.MutableRefObject<IMapObject | null>;
  onRegionClick: (e: Event, code: string) => void;
  onRegionTipShow: (e: Event) => void;
  onMarkerClick: (e: Event, code: string) => void;
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
      onMarkerClick={onMarkerClick as unknown as IVectorMapProps["onMarkerClick"]}
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
  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [showZoomHint, setShowZoomHint] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  /** Country to show inline in the live-feed panel (from map click or pill) */
  const [feedActiveCountry, setFeedActiveCountry] = useState<CountryNewsData | null>(null);
  const mapRef = useRef<IMapObject | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipPosRef = useRef({ x: 0, y: 0 });
  const [hoveredCountry, setHoveredCountry] = useState<CountryNewsData | null>(null);

  // Keep latest country lookup in a ref so the stable handler can access it
  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

  // Track previously choropleth-painted and selected codes for delta-paint
  const prevChoroplethRef = useRef<Set<string>>(new Set());
  const prevSelectedRef = useRef<Set<string>>(new Set());

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
      setFeedActiveCountry(country);
      setFeedOpen(true);
      setTappedCode(upperCode);
    }
  }, []);

  // Suppress jVectorMap's built-in region tooltips — the widget uses click-based
  // modals instead, and the default tooltip causes confusion for multi-polygon
  // regions (e.g. it would otherwise float over the wrong continent).
  const handleRegionTipShow = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // Dismiss the inline-detail country without closing the feed
  const handleDismissActive = useCallback(() => {
    setFeedActiveCountry(null);
  }, []);

  // Close the feed panel entirely — clears active country and map highlight
  const handleFeedClose = useCallback(() => {
    setFeedOpen(false);
    setFeedActiveCountry(null);
    setTappedCode(null);
  }, []);

  // Open feed with a country's inline detail (used by trending pills + conflict groups)
  const handlePillClick = useCallback((country: CountryNewsData) => {
    setFeedActiveCountry(country);
    setFeedOpen(true);
    setTappedCode(country.code);
  }, []);

  // Stable — never recreated, so StableMap never re-renders
  const handleMarkerClick = useCallback((_e: Event, code: string) => {
    const upperCode = code.toUpperCase();
    const country = countryByCodeRef.current.get(upperCode);
    if (country) {
      setFeedActiveCountry(country);
      setFeedOpen(true);
      setTappedCode(upperCode);
    }
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

  // Close the mobile bottom sheet (and desktop side panel) when Escape is pressed.
  // Also close category filter dropdown on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (filterOpen) { setFilterOpen(false); return; }
        if (feedOpen) handleFeedClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [feedOpen, filterOpen, handleFeedClose]);

  // Close category filter dropdown when clicking outside
  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-filter-dropdown]")) setFilterOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filterOpen]);

  // ── Hover tooltip — DOM event delegation (#3 Rising Popup, #14 Custom Popup) ─
  // Tracks which country the cursor is over via mouseover on region/marker SVG
  // elements and imperatively positions a fixed tooltip via ref (avoids
  // re-rendering on every mouse-move frame).
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      tooltipPosRef.current = { x: e.clientX, y: e.clientY };
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${e.clientX + 14}px`;
        tooltipRef.current.style.top = `${e.clientY - 8}px`;
      }
    };

    const onMouseOver = (e: MouseEvent) => {
      const el = e.target as Element;
      const region = el.closest(".jvectormap-region[data-code]");
      const marker = el.closest(".jvectormap-marker[data-index]");
      const code = (region?.getAttribute("data-code") ?? marker?.getAttribute("data-index"))?.toUpperCase();
      if (code) {
        tooltipPosRef.current = { x: e.clientX, y: e.clientY };
        setHoveredCountry(countryByCodeRef.current.get(code) ?? null);
      } else {
        setHoveredCountry(null);
      }
    };

    const onMouseLeave = () => setHoveredCountry(null);

    container.addEventListener("mousemove", onMouseMove, { passive: true });
    container.addEventListener("mouseover", onMouseOver, { passive: true });
    container.addEventListener("mouseleave", onMouseLeave, { passive: true });

    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseover", onMouseOver);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  /**
   * Delta-paint region fills using data-attributes + inline styles.
   *
   * Choropleth colouring: every region with events receives a `data-alert`
   * attribute matching its AlertLevel.  CSS rules keyed on [data-alert="…"]
   * apply theme-aware fills with smooth 0.45 s transitions and a classified
   * brightness/saturation boost on :hover — inspired by map-effects-100
   * "Fade-in Highlight" (#1) and "Classified Highlight Color" (#2).
   *
   * Selected / trending regions additionally receive an inline fill
   * (HOVER_FILL !important) which overrides the CSS choropleth rule.
   */
  const paintRegions = useCallback((
    choropleth: Map<string, string>,
    selected: Set<string>,
  ) => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Clear stale choropleth data-attributes
    for (const code of prevChoroplethRef.current) {
      if (!choropleth.has(code)) {
        container.querySelectorAll<SVGElement>(`[data-code="${code}"]`).forEach((el) => {
          delete el.dataset.alert;
          el.style.removeProperty("fill");
        });
      }
    }
    // Clear stale selected styling
    for (const code of prevSelectedRef.current) {
      if (!selected.has(code)) {
        container.querySelectorAll<SVGElement>(`[data-code="${code}"]`).forEach((el) => {
          delete el.dataset.selected;
          el.style.removeProperty("fill");
        });
      }
    }
    // Apply choropleth — CSS [data-alert] rules handle fill + dark-mode
    for (const [code, alertLevel] of choropleth) {
      container.querySelectorAll<SVGElement>(`[data-code="${code}"]`).forEach((el) => {
        el.dataset.alert = alertLevel;
        if (!selected.has(code)) el.style.removeProperty("fill");
      });
    }
    // Apply selected/trending — inline fill overrides CSS choropleth
    for (const code of selected) {
      container.querySelectorAll<SVGElement>(`[data-code="${code}"]`).forEach((el) => {
        el.dataset.selected = "true";
        el.style.setProperty("fill", HOVER_FILL, "important");
      });
    }

    prevChoroplethRef.current = new Set(choropleth.keys());
    prevSelectedRef.current = new Set(selected);
  }, []);

  // Choropleth + selection repaint when filtered countries / trending / tapped change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.clearSelectedRegions();

    const choropleth = new Map<string, string>();
    for (const c of countries) {
      if (c.alertLevel === "critical") choropleth.set(c.code, c.alertLevel);
    }

    const selected = new Set<string>();
    for (const code of trendingCodes) selected.add(code);
    if (tappedCode) selected.add(tappedCode);

    if (selected.size > 0) map.setSelectedRegions([...selected]);
    paintRegions(choropleth, selected);
  }, [countries, trendingCodes, tappedCode, paintRegions]);

  // Sync ping markers imperatively so they are rendered inside jVectorMap's SVG
  // and move correctly with the map when the user zooms or pans on mobile.
  // removeAllMarkers + re-add is the safest approach given jVectorMap's API.
  // Marker colour and radius vary by alertLevel; critical markers get an
  // expanding "ping ring" ghost circle (same effect as the notification bell).
  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    // Remove previously injected ping-ring ghost circles and glow classes
    container.querySelectorAll<SVGCircleElement>(".map-ping-ring, .map-ping-ring-2, .map-ping-ring-3").forEach((el) => el.remove());
    container.querySelectorAll<SVGCircleElement>(".map-marker-glow").forEach((el) => el.classList.remove("map-marker-glow"));

    map.removeAllMarkers();
    if (countries.length === 0) return;

    countries.forEach((country) => {
      const alertLevel = country.alertLevel ?? "watch";
      const fill = ALERT_LEVEL_MARKER_FILL[alertLevel] ?? ALERT_LEVEL_MARKER_FILL.watch;
      const r = (ALERT_LEVEL_MARKER_RADIUS[alertLevel] ?? ALERT_LEVEL_MARKER_RADIUS.watch) + (country.trending ? 0.5 : 0);

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

      // Inject expanding ping-rings: critical gets 3 concentric rings (radar
      // effect), high gets 1 ring.  Inspired by map-effects-100 #5 SVG Marker
      // Animation.  Critical markers also get a glow drop-shadow filter.
      const ringCount = alertLevel === "critical" ? 3 : alertLevel === "high" ? 1 : 0;
      if (ringCount > 0) {
        const ringClasses = ["map-ping-ring", "map-ping-ring-2", "map-ping-ring-3"];
        container.querySelectorAll<SVGCircleElement>(`[data-index="${country.code}"]`).forEach((markerEl) => {
          const cx = markerEl.getAttribute("cx") ?? "0";
          const cy = markerEl.getAttribute("cy") ?? "0";
          const parent = markerEl.parentElement;
          if (!parent) return;
          if (alertLevel === "critical") markerEl.classList.add("map-marker-glow");
          for (let i = 0; i < ringCount; i++) {
            const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            ring.setAttribute("cx", cx);
            ring.setAttribute("cy", cy);
            ring.setAttribute("r", String(r));
            ring.setAttribute("fill", fill);
            ring.setAttribute("pointer-events", "none");
            ring.classList.add(ringClasses[i]);
            ring.dataset.country = country.code;
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
        const rings = container.querySelectorAll<SVGCircleElement>(
          `.map-ping-ring[data-country="${code}"], .map-ping-ring-2[data-country="${code}"], .map-ping-ring-3[data-country="${code}"]`
        );
        if (rings.length === 0) continue;
        const cx = target.getAttribute("cx");
        const cy = target.getAttribute("cy");
        rings.forEach((ring) => {
          if (cx !== null) ring.setAttribute("cx", cx);
          if (cy !== null) ring.setAttribute("cy", cy);
        });
      }
    });

    container
      .querySelectorAll<Element>("[data-index]")
      .forEach((markerEl) => {
        observer.observe(markerEl, { attributes: true, attributeFilter: ["cx", "cy"] });
      });

    return () => observer.disconnect();
  }, [countries]);

  // ── Auto-focus map on critical hotspots after data loads ─────────────────────
  // Computes the geographic centroid of all critical-alert countries and gently
  // zooms/pans the map towards that region so the user immediately sees the
  // most important activity without needing to scroll.
  const initialFocusDoneRef = useRef(false);
  useEffect(() => {
    if (initialFocusDoneRef.current) return;
    const map = mapRef.current;
    if (!map || countries.length === 0) return;

    const critical = countries.filter((c) => c.alertLevel === "critical");
    // Fall back to high-alert countries if no critical ones exist
    const targets = critical.length > 0 ? critical : countries.filter((c) => c.alertLevel === "high");
    if (targets.length === 0) return;

    // Compute centroid
    const sumLat = targets.reduce((s, c) => s + c.lat, 0);
    const sumLng = targets.reduce((s, c) => s + c.lng, 0);
    const centLat = sumLat / targets.length;
    const centLng = sumLng / targets.length;

    // Determine zoom based on geographic spread — tighter cluster = higher zoom
    const latSpread = Math.max(...targets.map((c) => c.lat)) - Math.min(...targets.map((c) => c.lat));
    const lngSpread = Math.max(...targets.map((c) => c.lng)) - Math.min(...targets.map((c) => c.lng));
    const spread = Math.max(latSpread, lngSpread);
    // scale: 1.4 for widely spread hotspots, up to 2.8 for a tight cluster
    const scale = spread > 80 ? 1.4 : spread > 40 ? 1.8 : spread > 15 ? 2.2 : 2.8;

    // Use setFocus with lat/lng which internally calls pointToLatLng conversion.
    // Wrapped in rAF to ensure jVectorMap has finished its initial layout.
    requestAnimationFrame(() => {
      try {
        map.setFocus({ lat: centLat, lng: centLng, scale, animate: true });
      } catch {
        // Fallback: just do a gentle scale from centre
        const raw = map as unknown as Record<string, unknown>;
        if (typeof raw.setScale === "function") {
          const w = typeof raw.width  === "number" ? raw.width  : 0;
          const h = typeof raw.height === "number" ? raw.height : 0;
          (raw.setScale as (s: number, x: number, y: number, c: boolean, a: boolean) => void)(
            scale, w / 2, h / 2, false, true
          );
        }
      }
    });
    initialFocusDoneRef.current = true;
  }, [countries]);

  /** Count of countries at each alert level — shown in the footer summary */
  const alertCounts = useMemo(() => {
    const counts: Record<AlertLevel, number> = { critical: 0, high: 0, medium: 0, watch: 0 };
    for (const c of countries) counts[(c.alertLevel ?? "watch") as AlertLevel]++;
    return counts;
  }, [countries]);



  return (
    <div className="w-full">
      {/* Compact header — minimal vertical footprint so the map stays large */}
      <div className="flex items-center justify-between gap-3 px-1 pt-1 pb-2 sm:px-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90 whitespace-nowrap">
            Flashpoints
          </h3>
          {/* Live Feed button */}
          {data && countries.length > 0 && (
            <button
              onClick={() => setFeedOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label="Open live feed"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-error-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              Live Feed
            </button>
          )}
          {loading && (
            <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Updating…</span>
          )}
        </div>
      </div>

      {/* Map container — maximised height, cropped to reduce empty polar regions */}
      <div className="relative overflow-hidden rounded-xl">
        {/* Compact category filter — dropdown toggle, top-left of map */}
        <div className="absolute top-3 left-3 z-20">
          <div className="relative" data-filter-dropdown>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/80 bg-white/90 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/90 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4h18M3 12h18M3 20h18" strokeLinecap="round" />
              </svg>
              {categoryFilter === "all" ? "All Categories" : FILTER_LABELS[categoryFilter]}
              <svg className={`h-3 w-3 opacity-50 transition-transform ${filterOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {filterOpen && (
              <div className="absolute top-full left-0 mt-1 max-h-60 w-44 overflow-y-auto rounded-lg border border-gray-200/80 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/95">
                {(Object.keys(FILTER_LABELS) as CategoryFilter[])
                  .filter((f) => activeCategories.has(f))
                  .map((f) => (
                  <button
                    key={f}
                    onClick={() => { setCategoryFilter(f); setFilterOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                      categoryFilter === f
                        ? "bg-brand-500/10 font-semibold text-brand-600 dark:text-brand-400"
                        : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    {categoryFilter === f && (
                      <span className="h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                    )}
                    {FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div
          ref={mapContainerRef}
          className="h-[72vh] sm:h-[80vh] lg:h-[87vh] xl:h-[90vh] min-h-[480px]"
          style={{ transform: "scaleY(1.18)", transformOrigin: "center 42%" }}
        >
          <StableMap mapRef={mapRef} onRegionClick={handleRegionClick} onRegionTipShow={handleRegionTipShow} onMarkerClick={handleMarkerClick} />
        </div>

        {/* Vignette overlay — cinematic edge darkening (#23 Vignetting Map) */}
        <div className="map-vignette absolute inset-0 rounded-xl" aria-hidden="true" />

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
                    {level}{alertCounts[level] > 0 ? ` · ${alertCounts[level]}` : ""}
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

      {/* Rising tooltip — follows cursor on event regions/markers (#3 Rising Popup) */}
      {hoveredCountry && !feedOpen && (
        <div
          key={hoveredCountry.code}
          ref={tooltipRef}
          className="map-tooltip-rise pointer-events-none fixed z-50"
          style={{ left: tooltipPosRef.current.x + 14, top: tooltipPosRef.current.y - 8 }}
        >
          <div className="rounded-lg bg-gray-900/95 px-3 py-2.5 shadow-xl ring-1 ring-white/10 backdrop-blur-md min-w-[180px] max-w-[260px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base leading-none">{countryFlag(hoveredCountry.code)}</span>
              <span className="text-sm font-semibold text-white truncate">{hoveredCountry.name}</span>
              <span
                className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: (ALERT_LEVEL_MARKER_FILL[hoveredCountry.alertLevel] ?? "#888") + "22",
                  color: ALERT_LEVEL_MARKER_FILL[hoveredCountry.alertLevel] ?? "#888",
                }}
              >
                {hoveredCountry.alertLevel}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {hoveredCountry.events.length} event{hoveredCountry.events.length !== 1 ? "s" : ""}
              {hoveredCountry.trending && <span className="ml-1.5 text-error-400 font-medium">● Trending</span>}
            </p>
            {hoveredCountry.events[0] && (
              <p className="mt-1.5 text-[11px] text-gray-300 line-clamp-2 leading-snug">
                {hoveredCountry.events[0].title}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Footer — compact single-line: timestamp · trending · conflicts */}
      {data && (
        <div className="flex items-center gap-2 overflow-x-auto px-1 py-1.5 sm:px-0 scrollbar-none">
          <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
            {new Date(data.lastUpdated).toLocaleTimeString()}
            {data.usingMockData && " · demo"}
          </span>

          {trendingCountries.length > 0 && (
            <>
              <span className="shrink-0 text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Trend</span>
              {trendingCountries.map((c) => (
                <button
                  key={c.code}
                  onClick={() => handlePillClick(c)}
                  className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-error-500/25 bg-error-500/8 px-1.5 py-px text-[10px] font-medium text-error-700 hover:bg-error-500/15 dark:bg-error-500/15 dark:text-error-400"
                >
                  <span aria-label={c.name}>{countryFlag(c.code)}</span>
                  {c.name}
                </button>
              ))}
            </>
          )}

          {data.conflictGroups && data.conflictGroups.length > 0 && (
            <>
              <span className="shrink-0 h-3 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
              {data.conflictGroups.map((group) => {
                const members = group
                  .map((code) => countryByCodeRef.current.get(code))
                  .filter((c): c is CountryNewsData => c !== undefined);
                if (members.length < 2) return null;
                return (
                  <span
                    key={group.join("-")}
                    className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-warning-700 dark:text-warning-400"
                    title={members.map((m) => m.name).join(" vs ")}
                  >
                    {members.map((m, i) => (
                      <span key={m.code}>
                        {i > 0 && <span className="text-warning-500/50 mx-px">×</span>}
                        <button className="hover:underline" onClick={() => handlePillClick(m)}>
                          {countryFlag(m.code)}
                        </button>
                      </span>
                    ))}
                  </span>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Fullscreen Live Feed overlay ─────────────────────────────────────── */}
      {feedOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
            onClick={handleFeedClose}
            aria-hidden="true"
          />
          {/* Fullscreen panel */}
          <div
            className="fixed inset-2 sm:inset-4 lg:inset-6 z-[70] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Live Feed"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 sm:px-6 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <span className="text-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-error-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                Live Feed
                <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                  {countries.reduce((n, c) => n + c.events.length, 0)} events
                </span>
              </span>
              <button
                onClick={handleFeedClose}
                aria-label="Close live feed"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">Close</span>
                <kbd className="hidden sm:inline ml-1 rounded border border-gray-200 px-1 py-0.5 text-[10px] text-gray-400 dark:border-gray-700">Esc</kbd>
              </button>
            </div>
            {/* Feed content — fills remaining space */}
            <LiveEventFeed
              countries={countries}
              maxRows={100}
              activeCountry={feedActiveCountry}
              onDismissActive={handleDismissActive}
              panelMode
            />
          </div>
        </>
      )}
    </div>
  );
}
