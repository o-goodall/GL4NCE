"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { loadSettings, saveSettings, getEnabledFeedUrls, calcDCA, DEFAULT_SETTINGS, type Settings, type LiveSignals } from "@/lib/settings";

export type LatestBlock = { height: number; timestamp: number; size: number; txCount: number; miner: string; weight: number; medianFee: number | null; totalFees: number | null; reward: number | null };
export type MempoolStats = { count: number; vsize: number; totalFee: number };
export type Market = { id: string; question: string; topOutcome: string; probability: number; volume: number; volume24hr: number; endDate: string; tag: string; url: string; pinned: boolean };
export type NewsItem = { title: string; link: string; source: string; pubDate: string; description: string };
export type Holding = { symbol: string; name: string; allocationInPercentage: number; valueInBaseCurrency: number; netPerformancePercentWithCurrencyEffect: number; assetClass: string };

interface GlanceState {
  settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; saved: boolean;
  time: string;
  btcPrice: number; prevPrice: number; priceFlash: string; priceHistory: number[];
  btcBlock: number; btcFees: { low: number; medium: number; high: number };
  halvingBlocksLeft: number; halvingDays: number; halvingDate: string; halvingProgress: number;
  latestBlock: LatestBlock | null; mempoolStats: MempoolStats | null;
  fearGreed: number | null; fearGreedLabel: string; difficultyChange: number | null;
  fundingRate: number | null; audUsd: number | null; dcaUpdated: string;
  markets: Market[]; newsItems: NewsItem[];
  goldPriceUsd: number | null; goldYtdPct: number | null;
  sp500Price: number | null; sp500YtdPct: number | null; cpiAnnual: number | null;
  gfNetWorth: number | null; gfTotalInvested: number | null; gfNetGainPct: number | null;
  gfNetGainYtdPct: number | null; gfTodayChangePct: number | null;
  gfHoldings: Holding[]; gfError: string; gfLoading: boolean; gfUpdated: string;
  // derived
  dca: ReturnType<typeof calcDCA> | null;
  accentColor: string; priceColor: string;
  btcAud: number | null; satsPerAud: number | null;
  // actions
  persistSettings: (s: Settings) => void;
  refreshGhostfolio: () => Promise<void>;
}

const GlanceContext = createContext<GlanceState | undefined>(undefined);

export function useGlance() {
  const ctx = useContext(GlanceContext);
  if (!ctx) throw new Error("useGlance must be used within GlanceProvider");
  return ctx;
}

export function GlanceProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [time, setTime] = useState("");

  // BTC / Network
  const [btcPrice, setBtcPrice] = useState(0);
  const [prevPrice, setPrevPrice] = useState(0);
  const [priceFlash, setPriceFlash] = useState("");
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [btcBlock, setBtcBlock] = useState(0);
  const [btcFees, setBtcFees] = useState({ low: 0, medium: 0, high: 0 });
  const [halvingBlocksLeft, setHalvingBlocksLeft] = useState(0);
  const [halvingDays, setHalvingDays] = useState(0);
  const [halvingDate, setHalvingDate] = useState("");
  const [halvingProgress, setHalvingProgress] = useState(0);
  const [latestBlock, setLatestBlock] = useState<LatestBlock | null>(null);
  const [mempoolStats, setMempoolStats] = useState<MempoolStats | null>(null);

  // DCA signals
  const [fearGreed, setFearGreed] = useState<number | null>(null);
  const [fearGreedLabel, setFearGreedLabel] = useState("");
  const [difficultyChange, setDifficultyChange] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [audUsd, setAudUsd] = useState<number | null>(null);
  const [dcaUpdated, setDcaUpdated] = useState("");

  // Markets / News
  const [markets, setMarkets] = useState<Market[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [goldPriceUsd, setGoldPriceUsd] = useState<number | null>(null);
  const [goldYtdPct, setGoldYtdPct] = useState<number | null>(null);
  const [sp500Price, setSp500Price] = useState<number | null>(null);
  const [sp500YtdPct, setSp500YtdPct] = useState<number | null>(null);
  const [cpiAnnual, setCpiAnnual] = useState<number | null>(null);

  // Ghostfolio
  const [gfNetWorth, setGfNetWorth] = useState<number | null>(null);
  const [gfTotalInvested, setGfTotalInvested] = useState<number | null>(null);
  const [gfNetGainPct, setGfNetGainPct] = useState<number | null>(null);
  const [gfNetGainYtdPct, setGfNetGainYtdPct] = useState<number | null>(null);
  const [gfTodayChangePct, setGfTodayChangePct] = useState<number | null>(null);
  const [gfHoldings, setGfHoldings] = useState<Holding[]>([]);
  const [gfError, setGfError] = useState("");
  const [gfLoading, setGfLoading] = useState(false);
  const [gfUpdated, setGfUpdated] = useState("");

  // ── DERIVED VALUES ──
  const liveSignals: LiveSignals = useMemo(() => ({ fearGreed, difficultyChange, fundingRate, audUsd }), [fearGreed, difficultyChange, fundingRate, audUsd]);
  const dca = useMemo(() => btcPrice > 0 ? calcDCA(btcPrice, liveSignals) : null, [btcPrice, liveSignals]);
  const accentColor = useMemo(() => !dca ? '#3f3f46' : dca.finalAud === 0 ? '#f43f5e' : dca.finalAud >= 750 ? '#22c55e' : dca.finalAud >= 400 ? '#f7931a' : '#38bdf8', [dca]);
  const priceColor = useMemo(() => priceFlash === 'up' ? '#22c55e' : priceFlash === 'down' ? '#f43f5e' : '#e2e2e8', [priceFlash]);
  const btcAud = useMemo(() => btcPrice > 0 && audUsd !== null ? btcPrice * audUsd : null, [btcPrice, audUsd]);
  const satsPerAud = useMemo(() => btcAud !== null && btcAud > 0 ? Math.round(1e8 / btcAud) : null, [btcAud]);

  // ── FETCH FUNCTIONS ──
  const fetchBtc = useCallback(async () => {
    try {
      const d = await fetch('/api/bitcoin').then(r => r.json());
      setPrevPrice(btcPrice);
      setBtcPrice(d.price ?? 0);
      setBtcBlock(d.blockHeight ?? 0);
      setBtcFees(d.fees ?? { low: 0, medium: 0, high: 0 });
      if (d.halving) { setHalvingBlocksLeft(d.halving.blocksRemaining); setHalvingDays(d.halving.daysRemaining); setHalvingDate(d.halving.estimatedDate); setHalvingProgress(d.halving.progressPct); }
      if (d.latestBlock) setLatestBlock(d.latestBlock);
      if (d.mempool) setMempoolStats(d.mempool);
      if (d.price > 0) setPriceHistory(prev => [...prev.slice(-59), d.price]);
    } catch { /* */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDCA = useCallback(async () => {
    try {
      const d = await fetch('/api/dca').then(r => r.json());
      setFearGreed(d.fearGreed); setFearGreedLabel(d.fearGreedLabel);
      setDifficultyChange(d.difficultyChange); setFundingRate(d.fundingRate); setAudUsd(d.audUsd);
      setDcaUpdated(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    } catch { /* */ }
  }, []);

  const fetchPoly = useCallback(async (s: Settings) => {
    try {
      const kw = encodeURIComponent(JSON.stringify(s.polymarket.keywords));
      const data = await fetch(`/api/polymarket?keywords=${kw}`).then(r => r.json());
      setMarkets(data.markets ?? []);
    } catch { /* */ }
  }, []);

  const fetchNews = useCallback(async (s: Settings) => {
    try {
      const urls = getEnabledFeedUrls(s.news);
      const src = encodeURIComponent(JSON.stringify(urls));
      const data = await fetch(`/api/news?sources=${src}`).then(r => r.json());
      setNewsItems(data.items ?? []);
    } catch { /* */ }
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const d = await fetch('/api/markets').then(r => r.json());
      setGoldPriceUsd(d.gold?.priceUsd ?? null); setGoldYtdPct(d.gold?.ytdPct ?? null);
      setSp500Price(d.sp500?.price ?? null); setSp500YtdPct(d.sp500?.ytdPct ?? null);
      setCpiAnnual(d.cpiAnnual ?? null);
    } catch { /* */ }
  }, []);

  const fetchGhostfolio = useCallback(async (token?: string) => {
    const t = token ?? settings.ghostfolio?.token?.trim();
    if (!t) return;
    setGfLoading(true); setGfError("");
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(t)}`).then(r => r.json());
      if (d.error) { setGfError(d.error); }
      else {
        setGfNetWorth(d.netWorth); setGfTotalInvested(d.totalInvested);
        setGfNetGainPct(d.netGainPct); setGfNetGainYtdPct(d.netGainYtdPct);
        setGfTodayChangePct(d.todayChangePct); setGfHoldings(d.holdings ?? []);
        setGfUpdated(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
      }
    } catch { setGfError("Connection failed"); } finally { setGfLoading(false); }
  }, [settings.ghostfolio?.token]);

  const refreshGhostfolio = useCallback(async () => { await fetchGhostfolio(); }, [fetchGhostfolio]);

  // ── PERSIST SETTINGS ──
  const persistSettings = useCallback((s: Settings) => {
    saveSettings(s); setSettings(s); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    fetchPoly(s); fetchNews(s);
    if (s.ghostfolio?.token) fetchGhostfolio(s.ghostfolio.token);
  }, [fetchPoly, fetchNews, fetchGhostfolio]);

  // ── PRICE FLASH EFFECT ──
  useEffect(() => {
    if (prevPrice && btcPrice !== prevPrice) {
      setPriceFlash(btcPrice > prevPrice ? 'up' : 'down');
      const t = setTimeout(() => setPriceFlash(''), 1200);
      return () => clearTimeout(t);
    }
  }, [btcPrice, prevPrice]);

  // ── INIT + INTERVALS ──
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);

    // Clock
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const clockId = setInterval(tick, 1000);

    // Initial fetches
    fetchBtc(); fetchDCA(); fetchPoly(s); fetchNews(s); fetchMarkets();
    if (s.ghostfolio?.token) fetchGhostfolio(s.ghostfolio.token);

    // Refresh intervals
    const btcId = setInterval(fetchBtc, 60000);
    const dcaId = setInterval(fetchDCA, 300000);
    const polyId = setInterval(() => fetchPoly(s), 300000);
    const newsId = setInterval(() => fetchNews(s), 300000);
    const mktId = setInterval(fetchMarkets, 300000);
    const gfId = setInterval(() => { if (s.ghostfolio?.token) fetchGhostfolio(s.ghostfolio.token); }, 300000);

    return () => { clearInterval(clockId); clearInterval(btcId); clearInterval(dcaId); clearInterval(polyId); clearInterval(newsId); clearInterval(mktId); clearInterval(gfId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: GlanceState = {
    settings, setSettings, saved, time,
    btcPrice, prevPrice, priceFlash, priceHistory,
    btcBlock, btcFees, halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    latestBlock, mempoolStats,
    fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, dcaUpdated,
    markets, newsItems,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct, gfTodayChangePct,
    gfHoldings, gfError, gfLoading, gfUpdated,
    dca, accentColor, priceColor, btcAud, satsPerAud,
    persistSettings, refreshGhostfolio,
  };

  return <GlanceContext.Provider value={value}>{children}</GlanceContext.Provider>;
}
