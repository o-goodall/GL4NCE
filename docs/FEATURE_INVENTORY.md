# GL4NCE Feature Inventory

> Migration reference for rebuilding GL4NCE as a clean mobile PWA.
> Lists every function, hook, and module that drives the four core features.
> UI components, CSS, desktop-layout code, tests, and unused files are excluded.

---

## How to read this document

Each table covers one feature area and has five columns:

| Column | Meaning |
|--------|---------|
| **Name** | Function / hook / component / module |
| **File path** | Relative to repo root |
| **Purpose** | What it does in plain English |
| **Inputs → Outputs** | Key parameters and return values |
| **Dependencies** | External APIs, other functions in this list, or runtime globals |

---

## 1. Live BTC Price & History

Delivers the real-time price ticker and all historical price series shown in the chart.

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `getCachedPrices` | `src/components/ecommerce/BtcLiveChart.tsx` | Reads a cached historical price array from `localStorage`, validates TTL, converts legacy OHLC format to the current tuple format. Returns `null` when stale or missing. | `tf: Timeframe` → `PricePoint[] \| null` | `localStorage`, `TF_CONFIG[tf].cacheTTL` |
| `setCachedPrices` | `src/components/ecommerce/BtcLiveChart.tsx` | Writes a `[timestamp_ms, close]` array with a `fetchedAt` stamp to `localStorage`. Silently swallows quota errors. | `tf: Timeframe, data: PricePoint[]` → `void` | `localStorage` |
| `fetchKlines` | `src/components/ecommerce/BtcLiveChart.tsx` | Calls the Binance REST klines endpoint for a given interval/limit, returns raw kline tuples. Respects `AbortSignal` for cleanup. | `tf: Timeframe, signal: AbortSignal` → `Promise<RawKline[]>` | `Binance REST api.binance.com/api/v3/klines?symbol=BTCUSDT` |
| `fetchPrices` | `src/components/ecommerce/BtcLiveChart.tsx` | Orchestrates historical data retrieval: for the `ALL` timeframe tries the `/api/btc-history` CoinGecko proxy first (full history to 2013), falls back to `fetchKlines` on any error. For all other timeframes calls `fetchKlines` directly. | `tf: Timeframe, signal: AbortSignal` → `Promise<PricePoint[]>` | `fetchKlines`, `/api/btc-history` serverless proxy |
| `fetchGoldSpotPrice` | `src/components/ecommerce/BtcLiveChart.tsx` | Fetches the current gold spot price from the `/api/gold-price` serverless proxy. Used only when the gold-overlay toggle is active. | `signal: AbortSignal` → `Promise<number>` | `/api/gold-price` serverless proxy |
| `fetchGoldHistory` | `src/components/ecommerce/BtcLiveChart.tsx` | Fetches historical gold price series (range + interval selected by timeframe) from `/api/gold-history`. Cached per time-bucket TTL. | `goldTF: GoldTF, signal: AbortSignal` → `Promise<PricePoint[]>` | `/api/gold-history` serverless proxy |
| `computeRatioSeries` | `src/components/ecommerce/BtcLiveChart.tsx` | For each BTC timestamp finds the nearest gold price (linear interpolation) and divides to produce a BTC/Gold ratio series. Shown as an alternative chart mode. | `btcPrices: PricePoint[], goldPrices: PricePoint[]` → `PricePoint[]` | None |
| `BtcLiveChart` *(default export)* | `src/components/ecommerce/BtcLiveChart.tsx` | Top-level chart widget. Manages: (1) Binance WebSocket for ≤1 s live price updates with directional flash, (2) REST-fetched historical close series rendered in ApexCharts, (3) optional gold overlay, (4) BTC/Gold ratio mode, (5) touch-scrubbing tooltip, (6) timeframe tab (1D/1W/1M/6M/1Y/ALL). | Internal React state | Rendered JSX | `fetchPrices`, `fetchKlines`, `fetchGoldSpotPrice`, `fetchGoldHistory`, `computeRatioSeries`, `getCachedPrices/setCachedPrices`, Binance WebSocket `wss://stream.binance.com:9443` |
| `toWeeklyPoints` | `api/btc-history.ts` | Downsamples CoinGecko's dense daily history to ~weekly points (one point per 7 days ± 1 day tolerance) to keep payload size manageable. | `dailyMs: [number, number][]` → `[number, number][]` | None |
| `handler` *(default export)* | `api/btc-history.ts` | Vercel serverless function. Returns full BTC/USD price history from 2013 to present. Tries CoinGecko (`/coins/bitcoin/market_chart?days=max`) first; if the response has fewer than 500 points or fails, falls back to CryptoCompare weekly aggregates. Caches response at CDN edge for 24 h. | HTTP GET `/api/btc-history` → `{ data: [timestamp_ms, price][] }` | CoinGecko `api.coingecko.com`, CryptoCompare `min-api.cryptocompare.com` |

---

## 2. DCA Signal Generator

Decides how much BTC to buy each day within a user-configured 421-day window, guided by five on-chain/sentiment signals.

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `calcDailyAmt` | `src/components/ecommerce/MonthlyTarget.tsx` | Converts a weekly AUD savings amount to a flat daily buy amount across the 421-day window. Formula: `ceil(weeklyAmt × 52 × 4 ÷ 421 ÷ 5) × 5` (rounded up to nearest $5). | `weeklyAmtAUD: number` → `number` (daily AUD) | Constants: `WEEKS_PER_YEAR=52`, `YEARS_IN_CYCLE=4`, `DCA_WINDOW_DAYS=421` |
| `loadDcaSettings` | `src/components/ecommerce/MonthlyTarget.tsx` | Reads user-configured DCA settings (`slot1.weeklyAmtAUD`, optional `slot2`) from `localStorage`. Returns defaults (`$506/wk`) if nothing is stored or the format is invalid. | `void` → `DcaSettings` | `localStorage[dca-settings]` |
| `getCachedNumber` | `src/components/ecommerce/MonthlyTarget.tsx` | Generic single-value cache reader: reads a `{ price, fetchedAt }` object from `localStorage`, returns `null` when TTL has expired. Accepts both `{ data }` (BtcLiveChart format) and `{ price }` (legacy). | `key: string, ttl: number` → `number \| null` | `localStorage` |
| `setCachedNumber` | `src/components/ecommerce/MonthlyTarget.tsx` | Writes a single number with `fetchedAt` timestamp to `localStorage`. | `key: string, price: number` → `void` | `localStorage` |
| `fetchWeeklyKlines` | `src/components/ecommerce/MonthlyTarget.tsx` | Fetches the 250 most-recent weekly BTC/USDT klines from Binance (one call per session or cache miss). Provides raw data for ATH, 200WMA, and RSI derivation. | `signal: AbortSignal` → `Promise<RawKline[]>` | Binance REST `api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=250` |
| `deriveATH` | `src/components/ecommerce/MonthlyTarget.tsx` | Scans the `high` column of all weekly klines and returns the maximum. Used as the live PASS threshold (DCA pauses when spot price ≥ ATH). | `klines: RawKline[]` → `number \| null` | None |
| `deriveSMA` | `src/components/ecommerce/MonthlyTarget.tsx` | Simple moving average of the last `period` weekly close prices. Called with `period=200` to produce the 200-week moving average used by the "Below WMA" signal. | `klines: RawKline[], period: number` → `number \| null` | None |
| `deriveRSI` | `src/components/ecommerce/MonthlyTarget.tsx` | Wilder's smoothed RSI over `period` weekly candles. Seeded with simple average of first `period` moves, then Wilder-smoothed. Used as live confirmation within ±90-day cycle windows (RSI ≤ 30 = near trough active; RSI ≥ 70 = near peak active). | `klines: RawKline[], period: number` → `number \| null` | None |
| `nearestCycleDate` | `src/components/ecommerce/MonthlyTarget.tsx` | Finds the closest event in an array of epoch-millisecond cycle dates (troughs or peaks), returns days away and whether it is in the past. | `now: number, datesMs: readonly number[]` → `CycleDateInfo \| null` | Constants: `CYCLE_TROUGHS_MS`, `CYCLE_PEAKS_MS` |
| `getDcaPhase` | `src/components/ecommerce/MonthlyTarget.tsx` | Returns the current 3-phase strategy state: `"save"` before the DCA window, `"dca"` while inside it, `"hold"` after the window closes. Drives which four signals are shown and whether the gauge displays a buy amount or "HOLD". | `nowMs: number` → `"save" \| "dca" \| "hold"` | Constants: `DCA_START_MS` (2026-03-04), `DCA_END_MS` (2027-04-28) |
| `SignalItem` | `src/components/ecommerce/MonthlyTarget.tsx` | Presentational React component: renders one signal indicator pill with a coloured dot (emerald = active, grey = inactive), a label, and a sub-label. | `{ active: boolean, label: string, sub: string }` → JSX | None |
| `MonthlyTarget` *(default export)* | `src/components/ecommerce/MonthlyTarget.tsx` | Main DCA signal widget. Computes `recommendedBuy` (daily AUD or `"PASS"`) and renders: (1) ApexCharts radial gauge, (2) 3-phase strategy thermometer, (3) grid of 4 contextual signals (bear phase: Fear/Greed, Diff Drop, Below WMA, Near Trough; bull phase: Post-Halving, Above WMA, Near Peak, At ATH). | Internal React state | Rendered JSX | `fetchWeeklyKlines`, `deriveATH`, `deriveSMA`, `deriveRSI`, `getDcaPhase`, `nearestCycleDate`, Binance WebSocket (live price), Alternative.me Fear & Greed `api.alternative.me/fng`, mempool.space difficulty `mempool.space/api/v1/difficulty-adjustment` |

### DCA signal map

| Signal | Phase shown | Condition | Data source |
|--------|-------------|-----------|-------------|
| Fear / Greed | Save + DCA | Index ≤ 40 (active), ≤ 20 (extreme) | Alternative.me `/fng` |
| Diff Drop | Save + DCA | Last retarget < −5 % | mempool.space `/difficulty-adjustment` |
| Below 200 WMA | Save + DCA | Spot price < 200-week SMA | Binance weekly klines |
| Near Trough | Save + DCA | Within ±90 d of projected trough AND 14-week RSI ≤ 30 | Binance weekly klines |
| Post-Halving | Hold | Within 547 d after 2024-04-20 halving | Hardcoded halving date |
| Above 200 WMA | Hold | Spot price ≥ 200-week SMA | Binance weekly klines |
| Near Peak | Hold | Within ±90 d of projected peak AND 14-week RSI ≥ 70 | Binance weekly klines |
| At ATH | Hold | Spot price ≥ live ATH | Binance WebSocket + weekly klines |

---

## 3. Money Printer / Country Stats

Tracks M1/M2 monetary expansion and gross national debt for six major central banks, producing a 0–100 "printer score" per bank and a US composite score with four FRED macro indicators.

### Client-side

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `regimeCfg` | `src/components/ecommerce/MoneyPrinter.tsx` | Returns a `{ color, bg }` CSS-class object for a given regime string. Drives badge colours in the country table. | `regime: string` → `{ color: string, bg: string }` | None |
| `MoneyPrinter` *(default export)* | `src/components/ecommerce/MoneyPrinter.tsx` | Renders a table of six central banks (Fed/ECB/BoE/BoJ/BoC/PBOC) showing current M2 balance, month-on-month M2 change, gross debt, and a per-bank printer-score badge. Also shows the US composite "Money Printer Score" panel with four FRED indicators. Fetches `/api/m2` and `/api/printer` in parallel on mount. | Internal React state | Rendered JSX | `/api/m2`, `/api/printer` |

### Server-side (Vercel serverless functions)

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `computeBankPrinterScore` | `api/m2.ts` | Produces a 0–100 monetary-expansion score from M1 and M2 month-on-month growth rates. Sub-score formula: `clamp(momPct × 143, 0, 100)`. Composite: M1 weight 3/7 + M2 weight 4/7 when both available; M2 only when M1 is missing. | `m1MomPct: number \| null, m2MomPct: number` → `number` (0–100) | None |
| `bankScoreRegime` | `api/m2.ts` | Maps a 0–100 score to a human label used in both the per-bank badge and API response. | `score: number` → `"Normal" \| "Warming" \| "Alert" \| "Crisis"` | None |
| `handler` *(default export)* | `api/m2.ts` | Serverless function for `/api/m2`. For each of six central banks: (1) fetches M1 + M2 series from FRED (falling back to OECD SDMX for EU/UK/JP/CA), (2) fetches FX rates from FRED to convert to USD, (3) fetches debt-to-GDP from FRED + nominal GDP from World Bank to derive gross national debt. All per-bank requests are parallelised with `Promise.allSettled`. Caches response 1 h at CDN edge. | HTTP GET `/api/m2` → `{ countries: M2CountryResult[] }` | FRED API `api.stlouisfed.org`, OECD SDMX `sdmx.oecd.org`, World Bank `api.worldbank.org`, env `FRED_API_KEY` |
| `fetchFred` | `api/printer.ts` | Fetches the `limit` most-recent observations for a given FRED series ID in descending order. | `series: string, apiKey: string, limit: number` → `Promise<FredObs[]>` | FRED `api.stlouisfed.org/fred/series/observations`, env `FRED_API_KEY` |
| `parseObs` | `api/printer.ts` | Filters raw FRED observations to drop `"."` placeholder entries and parses values to floats. | `obs: FredObs[]` → `{ date: string, value: number }[]` | None |
| `regime` | `api/printer.ts` | Maps a 0–100 composite US printer score to its regime label. | `score: number` → `"Normal" \| "Warming" \| "Alert" \| "Brrrr"` | None |
| `handler` *(default export)* | `api/printer.ts` | Serverless function for `/api/printer`. Fetches four FRED series in parallel and computes a US-specific composite score: Fed balance-sheet WoW growth (30 %), M2 MoM growth (35 %), ICE BofA HY OAS credit spread (25 %), 10Y-2Y yield curve (10 %). Returns score, regime, per-indicator breakdown, and timestamp. Cached 6 h at CDN edge. | HTTP GET `/api/printer` → `{ score, regime, indicators[], updatedAt }` | FRED series: `WALCL`, `M2SL`, `BAMLH0A0HYM2`, `T10Y2Y`; env `FRED_API_KEY` |
| `handler` *(default export)* | `api/fred.ts` | Secure FRED proxy. Validates that the requested `series` parameter is on an allowlist (M1/M2/FX/balance-sheet/printer series only) before proxying to FRED with the server-side API key. Prevents the key from leaking to the browser. Cached 1 h at CDN edge. | HTTP GET `/api/fred?series=<ID>` → FRED JSON `observations[]` | FRED API, env `FRED_API_KEY` |

### Country coverage (`api/m2.ts`)

| ID | Bank | M1 source | M2 source | FX series |
|----|------|-----------|-----------|-----------|
| US | Fed | FRED `M1SL` | FRED `M2SL` | — (native USD) |
| EU | ECB | FRED `MANMM101EZM189S` / OECD MABMM101 | FRED `MABMM301EZM189S` / OECD MABMM301 | FRED `DEXUSEU` |
| GB | BoE | FRED `MANMM101GBM189S` / OECD MABMM101 | FRED `MABMM301GBM189S` / OECD MABMM301 | FRED `DEXUSUK` |
| JP | BoJ | FRED `MANMM101JPM189S` / OECD MABMM101 | FRED `MABMM301JPM189S` / OECD MABMM301 | FRED `DEXJPUS` (inverted) |
| CA | BoC | FRED `MANMM101CAM189S` / OECD MABMM101 | FRED `MABMM301CAM189S` / OECD MABMM301 | FRED `DEXCAUS` (inverted) |
| CN | PBOC | FRED `MYAGM1CNM189N` | FRED `MYAGM2CNM189N` | FRED `DEXCHUS` (inverted) |

---

## 4. Intel Map + Filtered News

Aggregates global news from 20+ RSS/Reddit sources, classifies events by category and severity, maps them to countries, and renders an interactive SVG world map with filters and a live event feed.

### React hooks

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `useNewsMap` | `src/components/news-map/useNewsMap.ts` | React hook: fetches `/api/news-map` on mount and polls every `pollMinutes` (default 15). Falls back to client-side mock data (`newsProcessor.generateMockData`) when the API is unavailable (e.g., local dev without Vercel runtime). Exposes a `refresh()` callback to force an immediate re-fetch. | `pollMinutes?: number` → `{ data: NewsMapData \| null, loading, error, nextRefreshAt, refresh }` | `/api/news-map`, `newsProcessor.generateMockData` (lazy import) |
| `usePulse` | `src/components/pulse/usePulse.ts` | React hook: fetches `/api/pulse` on mount, polls every `pollMinutes` (default 10) for the general world-news RSS feed. Fails gracefully with `error` state (no mock fallback — Pulse is non-critical). | `pollMinutes?: number` → `{ data: PulseData \| null, loading, error, nextRefreshAt, refresh }` | `/api/pulse` |

### React components

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `StableMap` | `src/components/news-map/NewsMapWidget.tsx` | Memoised SVG world map built on `@react-jvectormap`. Never re-renders after mount to prevent jVectorMap from losing imperative marker/region state. Exposes `mapRef` for external imperative calls (add markers, zoom, reset). | `{ mapRef, onRegionClick, onRegionTipShow, onMarkerClick }` → JSX | `@react-jvectormap/core`, `@react-jvectormap/world` |
| `NewsMapWidget` *(default export)* | `src/components/news-map/NewsMapWidget.tsx` | Main Intel map widget. Renders: (1) category filter buttons (All / Conflict / Terrorism / Military / …), (2) alert-level filter (All / Critical / High / Medium / Watch), (3) `StableMap` with colour-coded country fills and alert-level markers, (4) trending-country pill bar, (5) slide-out `LiveEventFeed` panel opened by map click or pill tap. All filtering is done client-side against the `useNewsMap` data. | Internal React state | Rendered JSX | `useNewsMap`, `StableMap`, `LiveEventFeed` |
| `PulseFeed` *(default export)* | `src/components/pulse/PulseFeed.tsx` | Grouped news feed widget on the Intel page. Renders article rows grouped by category (Conflict, Economy, Cyber, …). Category tabs filter the visible articles. | Internal React state | Rendered JSX | `usePulse` |

### Server-side pipeline (`api/news-map.ts`)

| Name | File path | Purpose | Inputs → Outputs | Dependencies |
|------|-----------|---------|------------------|--------------|
| `scoreCountries` | `api/scoringEngine.ts` | Deterministic country-detection scoring. Builds a score for each country in `countries.json` by counting keyword hits in article title + body, penalising negative-context matches (e.g., "condemned by France"), and rewarding proximity. Returns ranked `ScoredCountry[]`. | `article: ArticleInput, countries: CountryEntry[]` → `ScoredCountry[]` | `countries.json` (embedded keyword lists) |
| `calculateConfidence` | `api/scoringEngine.ts` | Normalises the top-ranked country score into a 0–1 confidence value. Used to suppress low-confidence attributions. | Top scores → `number` (0–1) | None |
| `getCountryByCode` | `api/scoringEngine.ts` | Looks up a country entry by ISO-3166 code. Used by the news-map aggregation loop. | `code: string` → `CountryEntry \| undefined` | `countries.json` |
| `classifyEvent` | `api/classifier.ts` | Detects event severity (`high/medium/low`) and category (`violent`, `terrorism`, `military`, `escalation`, `diplomatic`, `economic`, `commodities`, `cyber`, `health`, `environmental`, `disaster`, `infrastructure`, `crime`, `piracy`, `protest`, `minor`) from article title and optional body using precompiled regex keyword banks. Most-specific categories are checked first. | `title: string, body?: string` → `{ severity: EventSeverity, category: EventCategory }` | None (pure regex) |
| `cleanSnippet` | `api/classifier.ts` | Strips common RSS boilerplate (nav items, cookie banners, social-share CTAs, subscribe prompts) from content snippets before classification and scoring. | `snippet: string` → `string` | None |
| `computeAlertLevel` | `api/news-map.ts` | Maps a country's event severity distribution to one of four alert levels: `critical` (multiple high-severity events or trending with high severity), `high`, `medium`, `watch`. | `evs: NewsEvent[], isTrending: boolean` → `AlertLevel` | None |
| `computeEscalationIndex` | `api/news-map.ts` | Computes a weighted activity score for a country over a rolling 7-day window. Events in the last 24 h have full weight; older events are decayed. Higher scores indicate sustained conflict. | `code: string, evs: NewsEvent[]` → `number` | None |
| `computeTrending` | `api/news-map.ts` | Ranks countries by *velocity* — number of distinct high/medium-severity events in the most-recent 6-hour window. Returns trending set + 1-based rank map + active conflict groups. | `events: NewsEvent[]` (recent) → `{ trending: Set<string>, trendingRanks: Map<string,number>, conflictGroups: string[][] }` | `CONFLICT_GROUPS` from `sources.ts` |
| `aggregateCountries` | `api/news-map.ts` | Applies the 48-hour retention window, delegates trending detection, groups events by country code, and assembles the final `CountryNewsData[]` array with alert level, escalation index, and per-country event cap (`MAX_EVENTS_PER_COUNTRY`). | `events: NewsEvent[]` → `{ countries: CountryNewsData[], conflictGroups?: string[][] }` | `computeTrending`, `computeAlertLevel`, `computeEscalationIndex`, `getCountryByCode` |
| `handler` *(default export)* | `api/news-map.ts` | Vercel serverless function for `/api/news-map`. Orchestrates the full pipeline: (1) fetch up to `MAX_CONCURRENT_FETCHES` RSS feeds + Reddit JSON subreddits in parallel via `Promise.allSettled`, (2) deduplicate by title prefix (40 chars), (3) `classifyEvent` + `scoreCountries` each article, (4) `aggregateCountries`, (5) return `NewsMapData` JSON. Falls back to `generateMockData()` when all feeds fail. Cached 5 min at CDN edge. | HTTP GET `/api/news-map` → `{ countries[], lastUpdated, feedStats, conflictGroups? }` | `rss-parser`, `classifyEvent`, `cleanSnippet`, `scoreCountries`, `aggregateCountries`, `RSS_SOURCES` + `REDDIT_JSON_SUBREDDITS` from `sources.ts` |

### Feed sources (`api/sources.ts`)

| Export | Purpose |
|--------|---------|
| `RSS_SOURCES` | Array of `{ name, url }` for 20+ RSS feeds (Al Jazeera, BBC, AP, CNN, Guardian, DW, France24, Sky, RFE/RL, Euronews, CNA, Africanews, ReliefWeb, UN News, GDELT × 2, …) |
| `REDDIT_JSON_SUBREDDITS` | Reddit JSON endpoints for `r/worldnews` and `r/geopolitics` |
| `TELEGRAM_CHANNELS` | Telegram channels (currently unused — reserved for future scraping) |
| `SOURCE_WEIGHTS` | Per-source credibility multiplier applied to event scores |
| `CONFLICT_GROUPS` | Hardcoded arrays of ISO-3166 codes that represent the same active conflict (e.g., `["IL","PS","LB"]`) — used by `computeTrending` to surface conflict partners |
| `ARTICLES_PER_FEED` | Max articles parsed per feed (20) |
| `FETCH_TIMEOUT` | Per-feed HTTP timeout (10 000 ms) |
| `MAX_CONCURRENT_FETCHES` | Concurrency cap across all source types (12) |

---

## Environment variables required

| Variable | Used by | Purpose |
|----------|---------|---------|
| `FRED_API_KEY` | `api/m2.ts`, `api/printer.ts`, `api/fred.ts` | Free API key from research.stlouisfed.org for FRED data |

All other data sources (Binance, CoinGecko, CryptoCompare, OECD SDMX, World Bank, Alternative.me, mempool.space, RSS feeds, Reddit JSON) are public and require no API key.

---

## Data-flow summary

```
Feature                  Client hook / component          Server function                  External API
────────────────────────────────────────────────────────────────────────────────────────────────────────
Live BTC price           BtcLiveChart                     None                             Binance WebSocket
BTC history              BtcLiveChart → fetchPrices       btc-history.ts                   CoinGecko / CryptoCompare
Gold overlay             BtcLiveChart                     gold-price.ts, gold-history.ts   Yahoo Finance (GC=F gold futures)
DCA signal               MonthlyTarget                    None                             Binance REST, Alternative.me, mempool.space
Money printer (banks)    MoneyPrinter → /api/m2           m2.ts                            FRED, OECD, World Bank
Money printer (US)       MoneyPrinter → /api/printer      printer.ts                       FRED (WALCL, M2SL, BAMLH0A0HYM2, T10Y2Y)
Intel map                NewsMapWidget → useNewsMap        news-map.ts                      20+ RSS feeds, Reddit JSON
Pulse news feed          PulseFeed → usePulse             pulse.ts                         Various RSS feeds
```
