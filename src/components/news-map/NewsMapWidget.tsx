import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { CountryNewsData, EventCategory, AlertLevel } from "./types";
import { countryFlag } from "./mapUtils";
import { useNewsMap } from "./useNewsMap";
import LiveEventFeed from "./LiveEventFeed";
import { useTheme } from "../../context/ThemeContext";
import { numericToAlpha2 } from "./isoMapping";

// ── Leaflet bootstrap (must precede react-leaflet imports) ───────────────────
import "./leafletSetup";
import { MapContainer, TileLayer, Marker, GeoJSON, Tooltip, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import type { GeoJsonObject, Feature, Geometry } from "geojson";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

// ── Constants ────────────────────────────────────────────────────────────────

const ALERT_LEVEL_MARKER_FILL: Record<string, string> = {
  critical: "#F04438",
  high:     "#F79009",
  medium:   "#FFD300",
  watch:    "#98A2B3",
};

const ALERT_LEVEL_MARKER_RADIUS: Record<string, number> = {
  critical: 5,
  high:     4,
  medium:   3.5,
  watch:    3,
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

type AlertFilter = AlertLevel | "all";

// Tile layer URLs
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
const TILE_DARK  = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
const TILE_LABELS_LIGHT = "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png";
const TILE_LABELS_DARK  = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// World bounds — prevent infinite horizontal panning
const WORLD_BOUNDS = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));

// ── Load world GeoJSON from world-atlas TopoJSON ─────────────────────────────
// The 110 m file is ~28 KB — very lightweight for country boundaries.
let _worldGeoJson: GeoJsonObject | null = null;
async function loadWorldGeoJson(): Promise<GeoJsonObject> {
  if (_worldGeoJson) return _worldGeoJson;
  const topo: Topology = (await import("world-atlas/countries-110m.json" as string)) as unknown as Topology;
  const countriesObj = topo.objects.countries as GeometryCollection;
  const fc = topojson.feature(topo, countriesObj);
  // Inject alpha-2 code into each feature's properties for easy lookup
  if ("features" in fc) {
    for (const f of fc.features) {
      const numId = String(f.id ?? f.properties?.id ?? "");
      const alpha2 = numericToAlpha2(numId);
      if (alpha2) {
        f.properties = { ...f.properties, alpha2 };
      }
    }
  }
  _worldGeoJson = fc as GeoJsonObject;
  return _worldGeoJson;
}

// ── Theme-reactive tile layer component ──────────────────────────────────────
function ThemeTiles({ isDark }: { isDark: boolean }) {
  return (
    <>
      <TileLayer url={isDark ? TILE_DARK : TILE_LIGHT} attribution={TILE_ATTR} noWrap />
      <TileLayer url={isDark ? TILE_LABELS_DARK : TILE_LABELS_LIGHT} noWrap pane="tooltipPane" />
    </>
  );
}

// ── Auto-fit to critical countries on first data load ────────────────────────
function AutoFocus({ countries }: { countries: CountryNewsData[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || countries.length === 0) return;
    const critical = countries.filter((c) => c.alertLevel === "critical");
    const targets = critical.length > 0 ? critical : countries.filter((c) => c.alertLevel === "high");
    if (targets.length === 0) return;
    const bounds = L.latLngBounds(targets.map((c) => L.latLng(c.lat, c.lng)));
    map.flyToBounds(bounds.pad(0.5), { duration: 1.2, maxZoom: 5 });
    done.current = true;
  }, [countries, map]);
  return null;
}

// ── Dot size (px) keyed by alert level ───────────────────────────────────────
const ALERT_LEVEL_DOT_SIZE: Record<string, number> = {
  critical: 8,
  high:     7,
  medium:   6,
  watch:    5,
};

// ── Build a DivIcon per alert-level (cached so Leaflet doesn't recreate DOM) ─
const iconCache = new Map<string, L.DivIcon>();
function getDotIcon(alertLevel: string, trending: boolean): L.DivIcon {
  const key = `${alertLevel}-${trending}`;
  let icon = iconCache.get(key);
  if (icon) return icon;

  const size = (ALERT_LEVEL_DOT_SIZE[alertLevel] ?? 5) + (trending ? 1 : 0);
  const fill = ALERT_LEVEL_MARKER_FILL[alertLevel] ?? ALERT_LEVEL_MARKER_FILL.watch;
  const cls =
    alertLevel === "critical" ? "map-dot map-dot--critical" :
    alertLevel === "high" ? "map-dot map-dot--high" :
    "map-dot";

  icon = L.divIcon({
    className: "", // avoid default leaflet-div-icon styling
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 - 2],
    html: `<span class="${cls}" style="width:${size}px;height:${size}px;background:${fill}"></span>`,
  });
  iconCache.set(key, icon);
  return icon;
}

// ── Pulse marker — tiny HTML dot with CSS box-shadow pulse ───────────────────
function PulseMarker({ country, onClick }: {
  country: CountryNewsData;
  onClick: (c: CountryNewsData) => void;
}) {
  const alertLevel = country.alertLevel ?? "watch";
  const pos: L.LatLngExpression = [country.lat, country.lng];
  const icon = useMemo(() => getDotIcon(alertLevel, !!country.trending), [alertLevel, country.trending]);

  return (
    <Marker
      position={pos}
      icon={icon}
      eventHandlers={{ click: () => onClick(country) }}
    >
      <Tooltip direction="top" offset={[0, -6]} opacity={1} className="map-leaflet-tooltip">
        <div className="flex items-center gap-1.5">
          <span>{countryFlag(country.code)}</span>
          <strong>{country.name}</strong>
        </div>
        <div className="text-[10px] opacity-70">
          {country.events.length} event{country.events.length !== 1 ? "s" : ""} · {alertLevel}
          {country.trending && " · Trending"}
        </div>
      </Tooltip>
    </Marker>
  );
}

// ── Country choropleth GeoJSON layer (critical countries get a fill) ─────────
function CountryLayer({
  geoData,
  criticalCodes,
  onCountryClick,
}: {
  geoData: GeoJsonObject;
  criticalCodes: Set<string>;
  onCountryClick: (code: string) => void;
}) {
  const geoStyle = useCallback(
    (feature?: Feature<Geometry>) => {
      const alpha2: string = feature?.properties?.alpha2 ?? "";
      const isCritical = criticalCodes.has(alpha2);
      return {
        fillColor: isCritical ? "#FFD300" : "transparent",
        fillOpacity: isCritical ? 0.3 : 0,
        color: isCritical ? "#FFD300" : "transparent",
        weight: isCritical ? 1 : 0,
      };
    },
    [criticalCodes],
  );

  const onEachFeature = useCallback(
    (feature: Feature<Geometry>, layer: L.Layer) => {
      const alpha2: string = feature?.properties?.alpha2 ?? "";
      if (!alpha2) return;
      const isCritical = criticalCodes.has(alpha2);

      layer.on({
        mouseover: (e: L.LeafletMouseEvent) => {
          if (isCritical) return; // already highlighted
          const target = e.target as L.Path;
          target.setStyle({ fillColor: "#FFD300", fillOpacity: 0.3, color: "#FFD300", weight: 1 });
          target.bringToFront();
        },
        mouseout: (e: L.LeafletMouseEvent) => {
          if (isCritical) return;
          const target = e.target as L.Path;
          target.setStyle({
            fillColor: "transparent",
            fillOpacity: 0,
            color: "transparent",
            weight: 0,
          });
        },
        click: () => onCountryClick(alpha2),
      });
    },
    [criticalCodes, onCountryClick],
  );

  return <GeoJSON key={`${[...criticalCodes].join()}`} data={geoData} style={geoStyle} onEachFeature={onEachFeature} />;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main widget
// ══════════════════════════════════════════════════════════════════════════════
export default function NewsMapWidget() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { data, loading } = useNewsMap();

  const [tappedCode, setTappedCode] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedActiveCountry, setFeedActiveCountry] = useState<CountryNewsData | null>(null);
  const [geoData, setGeoData] = useState<GeoJsonObject | null>(null);

  const countryByCodeRef = useRef(new Map<string, CountryNewsData>());

  // Load world GeoJSON once
  useEffect(() => {
    loadWorldGeoJson().then(setGeoData);
  }, []);

  const allCountries = useMemo(() => data?.countries ?? [], [data]);

  const activeCategories = useMemo<Set<CategoryFilter>>(() => {
    const cats = new Set<CategoryFilter>(["all"]);
    for (const c of allCountries) {
      for (const e of c.events) cats.add(e.category as CategoryFilter);
    }
    return cats;
  }, [allCountries]);

  useEffect(() => {
    if (categoryFilter !== "all" && !activeCategories.has(categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [activeCategories, categoryFilter]);

  const countries = useMemo(() => {
    let result = allCountries;
    if (categoryFilter !== "all") {
      result = result
        .map((c) => ({ ...c, events: c.events.filter((e) => e.category === categoryFilter) }))
        .filter((c) => c.events.length > 0);
    }
    if (alertFilter !== "all") {
      result = result.filter((c) => c.alertLevel === alertFilter);
    }
    return result;
  }, [allCountries, categoryFilter, alertFilter]);

  const trendingCountries = useMemo(
    () => countries.filter((c) => c.trending).sort((a, b) => (a.trendingRank ?? 99) - (b.trendingRank ?? 99)),
    [countries],
  );

  const trendingCodes = useMemo(() => new Set(trendingCountries.map((c) => c.code)), [trendingCountries]);

  const criticalCodes = useMemo(
    () => new Set(countries.filter((c) => c.alertLevel === "critical").map((c) => c.code)),
    [countries],
  );

  countryByCodeRef.current = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);

  const alertCounts = useMemo(() => {
    const counts: Record<AlertLevel, number> = { critical: 0, high: 0, medium: 0, watch: 0 };
    for (const c of countries) counts[(c.alertLevel ?? "watch") as AlertLevel]++;
    return counts;
  }, [countries]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleDismissActive = useCallback(() => setFeedActiveCountry(null), []);

  const handleFeedClose = useCallback(() => {
    setFeedOpen(false);
    setFeedActiveCountry(null);
    setTappedCode(null);
  }, []);

  const handlePillClick = useCallback((country: CountryNewsData) => {
    setFeedActiveCountry(country);
    setFeedOpen(true);
    setTappedCode(country.code);
  }, []);

  const handleMarkerClick = useCallback((country: CountryNewsData) => {
    setFeedActiveCountry(country);
    setFeedOpen(true);
    setTappedCode(country.code);
  }, []);

  const handleCountryClick = useCallback((code: string) => {
    const country = countryByCodeRef.current.get(code);
    if (country) {
      setFeedActiveCountry(country);
      setFeedOpen(true);
      setTappedCode(code);
    }
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-filter-dropdown]")) setFilterOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filterOpen]);

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-1 pt-1 pb-2 sm:px-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="inline-flex items-center justify-center"
            aria-hidden="true"
          >
            <span
              className="material-symbols-outlined text-[#FFD300] text-[24px] leading-none"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              travel_explore
            </span>
          </span>
          <h3 className="text-3xl sm:text-4xl font-semibold text-gray-800 dark:text-white/90 whitespace-nowrap">Flashpoints</h3>
          {loading && <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Updating…</span>}
        </div>
        {data && (
          <span className="shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
            {new Date(data.lastUpdated).toLocaleTimeString()}
            {data.usingMockData && " · demo"}
          </span>
        )}
      </div>

      {/* Map container */}
      <div className="relative overflow-hidden rounded-xl">
        {/* Category filter dropdown */}
        <div className="absolute top-3 left-3 z-[1000]">
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
                    {categoryFilter === f && <span className="h-1 w-1 shrink-0 rounded-full bg-brand-500" />}
                    {FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Alert legend */}
        <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-gray-200/80 bg-white/90 px-2.5 py-1.5 backdrop-blur-sm shadow-sm dark:border-gray-700/80 dark:bg-gray-800/90">
          <div className="flex flex-col gap-1">
            {(["critical", "high", "medium", "watch"] as AlertLevel[]).map((level) => {
              const isActive = alertFilter === level;
              const isDimmed = alertFilter !== "all" && alertFilter !== level;
              return (
                <button
                  key={level}
                  onClick={() => setAlertFilter(isActive ? "all" : level)}
                  title={isActive ? "Show all alert levels" : `Filter to ${level} only`}
                  aria-pressed={isActive}
                  className={`flex items-center gap-1.5 rounded px-0.5 py-0.5 text-left transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${isDimmed ? "opacity-30" : "opacity-100"} ${isActive ? "ring-1 ring-brand-400 ring-offset-1 dark:ring-offset-gray-800" : ""}`}
                >
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: ALERT_LEVEL_MARKER_RADIUS[level] * 2,
                      height: ALERT_LEVEL_MARKER_RADIUS[level] * 2,
                      backgroundColor: ALERT_LEVEL_MARKER_FILL[level],
                      border: "1.5px solid #ffffff",
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

        {/* Vignette */}
        <div className="map-vignette absolute inset-0 rounded-xl z-[500] pointer-events-none" aria-hidden="true" />

        {/* Leaflet map */}
        <div className="h-[72vh] sm:h-[80vh] lg:h-[87vh] xl:h-[90vh] min-h-[480px]">
          <MapContainer
            center={[25, 20]}
            zoom={2}
            minZoom={2}
            maxZoom={8}
            maxBounds={WORLD_BOUNDS}
            maxBoundsViscosity={0.8}
            zoomControl={false}
            attributionControl={false}
            // @ts-expect-error — gestureHandling augmented in leaflet-gesture-handling.d.ts
            gestureHandling={true}
            className="h-full w-full rounded-xl"
            style={{ background: isDark ? "#1a1d23" : "#f8f9fa" }}
          >
            <ThemeTiles isDark={isDark} />
            <ZoomControl position="bottomright" />
            <AutoFocus countries={countries} />

            {/* Country choropleth overlay */}
            {geoData && (
              <CountryLayer
                geoData={geoData}
                criticalCodes={criticalCodes}
                onCountryClick={handleCountryClick}
              />
            )}

            {/* Event markers */}
            {countries.map((country) => (
              <PulseMarker key={country.code} country={country} onClick={handleMarkerClick} />
            ))}
          </MapContainer>
        </div>

        {!loading && countries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]">
            <p className="text-sm text-gray-400 dark:text-gray-500">No events detected</p>
          </div>
        )}
      </div>

      {/* Footer — trending */}
      {data && trendingCountries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2.5 pb-1 sm:px-0">
          <span className="shrink-0 rounded bg-error-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-error-600 dark:bg-error-500/20 dark:text-error-400">
            Trending
          </span>
          {trendingCountries.map((c) => (
            <button
              key={c.code}
              onClick={() => handlePillClick(c)}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-error-200 bg-error-50 px-2 py-0.5 text-[11px] font-medium text-error-700 shadow-sm transition-colors hover:bg-error-100 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400 dark:hover:bg-error-500/20"
            >
              <span aria-label={c.name}>{countryFlag(c.code)}</span>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen Live Feed overlay */}
      {feedOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]" onClick={handleFeedClose} aria-hidden="true" />
          <div className="fixed inset-2 sm:inset-4 lg:inset-6 z-[9999] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Live Feed">
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
            <LiveEventFeed countries={countries} maxRows={100} activeCountry={feedActiveCountry} onDismissActive={handleDismissActive} panelMode />
          </div>
        </>
      )}
    </div>
  );
}
