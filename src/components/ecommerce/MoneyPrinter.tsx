import { useEffect, useState } from "react";

// ── Types (mirror /api/printer response) ──────────────────────────────────

interface PrinterIndicator {
  label:    string;
  value:    number;
  score:    number;
  weight:   number;
  elevated: boolean;
  arrow?:   "up" | "down" | "flat";
  detail?:  string;
}

interface PrinterData {
  brrrLevel:   number;
  score:       number;
  regime:      string;
  status:      string;
  liquidity: {
    current:   number;
    change30d: number;
    walcl:     number;
    rrp:       number;
    tga:       number;
  };
  rates: {
    fedFunds:    number | null;
    yield2y:     number | null;
    sofr:        number | null;
    sofrSpread:  number | null;
    repoStress:  boolean;
  };
  forward: {
    rateCutProb:   number;
    recessionProb: number;
  };
  indicators:  PrinterIndicator[];
  updatedAt:   string;
}

// ── Level config ──────────────────────────────────────────────────────────

interface LevelConfig {
  color:     string;
  bg:        string;
  barColor:  string;
  label:     string;
}

function levelCfg(level: number): LevelConfig {
  switch (level) {
    case 5: return { color: "text-red-500 dark:text-red-400",       bg: "bg-red-500/10 dark:bg-red-500/20",       barColor: "bg-red-500",       label: "Crisis Printing" };
    case 4: return { color: "text-orange-500 dark:text-orange-400", bg: "bg-orange-500/10 dark:bg-orange-500/20", barColor: "bg-orange-500",    label: "Heavy Printing" };
    case 3: return { color: "text-yellow-500 dark:text-yellow-400", bg: "bg-yellow-500/10 dark:bg-yellow-500/20", barColor: "bg-yellow-500",    label: "Active Stimulus" };
    case 2: return { color: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-500/10 dark:bg-emerald-500/20", barColor: "bg-emerald-500", label: "Liquidity Rising" };
    case 1: return { color: "text-gray-500 dark:text-gray-400",     bg: "bg-gray-500/10 dark:bg-gray-500/20",     barColor: "bg-gray-400",      label: "Neutral" };
    default: return { color: "text-blue-500 dark:text-blue-400",    bg: "bg-blue-500/10 dark:bg-blue-500/20",     barColor: "bg-blue-500",      label: "Tightening" };
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtBillions(b: number): string {
  const t = b / 1_000;
  if (Math.abs(t) >= 100) return `$${t.toFixed(0)}T`;
  if (Math.abs(t) >= 10)  return `$${t.toFixed(1)}T`;
  if (Math.abs(t) >= 1)   return `$${t.toFixed(2)}T`;
  return `$${Math.abs(b).toFixed(0)}B`;
}

function fmtDelta(b: number): string {
  const sign = b >= 0 ? "+" : "-";
  const abs = Math.abs(b);
  if (abs >= 1_000) {
    const t = abs / 1_000;
    return `${sign}$${t >= 10 ? t.toFixed(1) : t.toFixed(2)}T`;
  }
  return `${sign}$${abs.toFixed(0)}B`;
}

function fmtRate(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}%`;
}

function arrowIcon(arrow?: "up" | "down" | "flat"): string {
  if (arrow === "up") return "↑";
  if (arrow === "down") return "↓";
  return "→";
}

// ── Component ─────────────────────────────────────────────────────────────

export default function MoneyPrinter() {
  const [data, setData] = useState<PrinterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/printer", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PrinterData;
        if (!controller.signal.aborted) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Data unavailable right now.");
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  const level = data?.brrrLevel ?? 0;
  const cfg = levelCfg(level);
  const pct = data ? Math.min(100, Math.max(0, data.score)) : 0;

  // ── Skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="relative w-full px-1 py-1 sm:px-0">
        <div className="flex items-center gap-2 mb-5">
          <span
            className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
            aria-hidden="true"
            style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
          >
            print
          </span>
          <div className="h-9 w-40 rounded bg-gray-100 dark:bg-gray-800 animate-pulse sm:h-10" />
        </div>
        <div className="space-y-4 animate-pulse">
          <div className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800" />
          <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
          <div className="h-32 rounded-xl bg-gray-100 dark:bg-gray-800" />
        </div>
      </section>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section className="relative w-full px-1 py-1 sm:px-0">
        <div className="flex items-center gap-2 mb-5">
          <span
            className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
            aria-hidden="true"
            style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
          >
            print
          </span>
          <span className="text-3xl font-semibold leading-none text-gray-400 dark:text-gray-500 sm:text-4xl">
            —
          </span>
        </div>
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          {error ?? "No data available."}
        </div>
      </section>
    );
  }

  return (
    <section className="relative w-full px-1 py-1 sm:px-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-5">
        <span
          className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
          aria-hidden="true"
          style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
        >
          print
        </span>
        <span className={`text-3xl font-semibold leading-none sm:text-4xl ${cfg.color}`}>
          {data.regime}
        </span>
      </div>

      {/* ── BRRR Level Hero ────────────────────────────────────────────── */}
      <div className={`rounded-xl p-4 md:p-5 mb-4 ${cfg.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              BRRR Level
            </div>
            <div className={`text-3xl md:text-4xl font-bold tabular-nums ${cfg.color}`}>
              {data.brrrLevel} <span className="text-lg md:text-xl font-normal text-gray-400 dark:text-gray-500">/ 5</span>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-sm md:text-base font-semibold ${cfg.color}`}>
              {data.regime}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {data.status}
            </div>
          </div>
        </div>

        {/* Level bar (5 segments) */}
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map((i) => {
            const segCfg = levelCfg(i + 1);
            const active = data.brrrLevel > i;
            return (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                  active ? segCfg.barColor : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
            );
          })}
        </div>

        {/* Liquidity change callout */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Liquidity Δ (30d):</span>
          <span className={`text-sm font-bold tabular-nums ${
            data.liquidity.change30d >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
          }`}>
            {fmtDelta(data.liquidity.change30d)}
          </span>
        </div>
      </div>

      {/* ── Composite progress bar ─────────────────────────────────────── */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Composite Score
          </span>
          <span className={`text-xs font-bold tabular-nums ${cfg.color}`}>
            {data.score}/100
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${cfg.barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Three Pillar Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {data.indicators.filter((ind) => ind.weight > 0).map((ind) => {
          const isElevated = ind.elevated;
          return (
            <div
              key={ind.label}
              className={`rounded-xl border p-3 md:p-4 ${
                isElevated
                  ? "border-orange-200 bg-orange-50/50 dark:border-orange-500/30 dark:bg-orange-500/5"
                  : "border-gray-200 bg-white dark:border-gray-700 dark:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] md:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {ind.label}
                </span>
                <span className={`text-sm font-bold ${
                  isElevated ? "text-orange-500 dark:text-orange-400" : "text-gray-600 dark:text-gray-300"
                }`}>
                  {arrowIcon(ind.arrow)}
                </span>
              </div>
              <div className={`text-lg md:text-xl font-bold tabular-nums ${
                isElevated ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-200"
              }`}>
                {ind.score}<span className="text-xs font-normal text-gray-400">/100</span>
              </div>
              {ind.detail && (
                <div className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {ind.detail}
                </div>
              )}
              <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700 mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isElevated ? "bg-orange-400" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                  style={{ width: `${Math.min(100, ind.score)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Repo Stress Alert ──────────────────────────────────────────── */}
      {data.rates.repoStress && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/5 p-3 flex items-center gap-2">
          <span className="text-red-500 text-sm">⚠️</span>
          <span className="text-xs font-medium text-red-600 dark:text-red-400">
            Repo Stress Detected — SOFR elevated {data.rates.sofrSpread !== null ? `+${(data.rates.sofrSpread * 100).toFixed(0)}bps` : ""} above Fed Funds
          </span>
        </div>
      )}

      {/* ── Detailed Breakdown ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-3 md:px-4 py-2 md:py-3 bg-gray-50 dark:bg-white/[0.02] border-b border-gray-200 dark:border-gray-700">
          <span className="text-[10px] md:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Breakdown
          </span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Liquidity section */}
          <div className="px-3 md:px-4 py-2.5 md:py-3">
            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              Liquidity Formula
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Fed Balance Sheet</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{fmtBillions(data.liquidity.walcl)}</div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Reverse Repo</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">−{fmtBillions(data.liquidity.rrp)}</div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Treasury Account</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">−{fmtBillions(data.liquidity.tga)}</div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">= Net Liquidity</div>
                <div className="font-bold text-gray-800 dark:text-white tabular-nums">{fmtBillions(data.liquidity.current)}</div>
              </div>
            </div>
          </div>

          {/* Rates section */}
          <div className="px-3 md:px-4 py-2.5 md:py-3">
            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              Interest Rate Pressure
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Fed Funds Rate</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{fmtRate(data.rates.fedFunds)}</div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">2Y Treasury</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{fmtRate(data.rates.yield2y)}</div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">SOFR</div>
                <div className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{fmtRate(data.rates.sofr)}</div>
              </div>
            </div>
          </div>

          {/* Forward signal section */}
          <div className="px-3 md:px-4 py-2.5 md:py-3">
            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              Prediction Markets (Forward Signal)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Rate Cut Probability</div>
                <div className={`font-semibold tabular-nums ${
                  data.forward.rateCutProb >= 60
                    ? "text-orange-500 dark:text-orange-400"
                    : data.forward.rateCutProb >= 0
                      ? "text-gray-700 dark:text-gray-200"
                      : "text-gray-400 dark:text-gray-500"
                }`}>
                  {data.forward.rateCutProb >= 0 ? `${data.forward.rateCutProb}%` : "—"}
                  {data.forward.rateCutProb >= 80 && (
                    <span className="ml-1 text-[10px] text-red-500 dark:text-red-400 font-medium">printer likely</span>
                  )}
                  {data.forward.rateCutProb >= 60 && data.forward.rateCutProb < 80 && (
                    <span className="ml-1 text-[10px] text-orange-500 dark:text-orange-400 font-medium">BRRR risk rising</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-gray-400 dark:text-gray-500 mb-0.5">Recession Probability</div>
                <div className={`font-semibold tabular-nums ${
                  data.forward.recessionProb >= 50
                    ? "text-red-500 dark:text-red-400"
                    : data.forward.recessionProb >= 0
                      ? "text-gray-700 dark:text-gray-200"
                      : "text-gray-400 dark:text-gray-500"
                }`}>
                  {data.forward.recessionProb >= 0 ? `${data.forward.recessionProb}%` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
