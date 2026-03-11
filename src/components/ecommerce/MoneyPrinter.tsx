import { useEffect, useState } from "react";

// ── Types (mirror /api/printer FRLI response) ─────────────────────────────

interface FrliMetric {
  label:    string;
  raw:      number;
  zScore:   number;
  weight:   number;
  arrow:    "up" | "down" | "flat";
  detail:   string;
}

interface FrliData {
  frliLevel:   number;
  frliScore:   number;
  regime:      string;
  status:      string;
  metrics:     FrliMetric[];
  balanceSheetYoY: number;
  balanceSheetTotal: number;
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
  updatedAt:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtRate(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}%`;
}

function getCycleGradient(): string {
  return "linear-gradient(to right, #FFD700, #FFC700, #FF8C00, #FF4500, #FF0000, #B22222, #CD5C5C, #E0FFFF)";
}

// ── Fed Balance Sheet scale constants ──────────────────────────────────
const BS_BASELINE   = 1;      // $1T left edge
const BS_2008       = 4.5;    // $4.5T post-GFC
const BS_COVID      = 8.9;    // $8.9T COVID peak
const BS_CEILING    = 30;     // $30T right edge (future headroom)
const BS_RANGE      = BS_CEILING - BS_BASELINE; // 29T
const pctOf = (v: number) => ((v - BS_BASELINE) / BS_RANGE) * 100;
const BS_2008_PCT   = pctOf(BS_2008);   // ~12.1%
const BS_COVID_PCT  = pctOf(BS_COVID);  // ~27.2%

// ── MiniStat (same pattern as BlockchainVisualizer) ───────────────────────

interface MiniStatProps {
  label:       string;
  value:       string;
  sub?:        string;
  active:      boolean;
  valueColor?: string;
  dotColor?:   string;
  loading:     boolean;
}

function MiniStat({
  label,
  value,
  sub,
  active = false,
  valueColor = "text-gray-800 dark:text-white/90",
  dotColor = "bg-gray-300 dark:bg-gray-600",
  loading,
}: MiniStatProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${loading ? "bg-gray-300 dark:bg-gray-600" : dotColor}`} />
        <span
          className={`text-[10px] font-semibold leading-tight transition-colors duration-300 ${
            active ? "text-gray-800 dark:text-white/90" : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {label}
        </span>
      </div>
      {loading ? (
        <div className="h-3.5 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ) : (
        <span className={`text-[10px] tabular-nums transition-colors duration-300 ${active ? valueColor : "text-gray-400 dark:text-gray-500"}`}>
          {value}
        </span>
      )}
      {sub && !loading && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-none">{sub}</span>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function MoneyPrinter() {
  const [data, setData] = useState<FrliData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayedPct, setDisplayedPct] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/printer", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FrliData;
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

  // Animate gauge bar (matches ProgressRow pattern from BlockchainVisualizer)
  const targetPct = data ? Math.min(100, Math.max(0, (data.frliLevel / 5) * 100)) : 0;
  useEffect(() => {
    if (loading || !data) { setDisplayedPct(0); return; }
    setDisplayedPct(0);
    let f1 = 0, f2 = 0;
    f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => setDisplayedPct(targetPct));
    });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); };
  }, [loading, data, targetPct]);

  // ── Derived display values ────────────────────────────────────────────
  const m2Metric   = data?.metrics.find((m) => m.label === "M1/M2 YoY");
  const m2Growth   = m2Metric?.detail ?? "—";
  const m2Arrow    = m2Metric?.arrow;
  const m2Active   = m2Metric != null;
  const m2Display  = m2Arrow === "up" ? `${m2Growth} ▲`
                   : m2Arrow === "down" ? `${m2Growth} ▼`
                   : `${m2Growth} ─`;

  const fedRate    = data?.rates.fedFunds ?? null;
  const rateCut    = data?.forward.rateCutProb ?? -1;
  const frliScore  = data?.frliScore ?? 0;

  // Net liquidity direction from composite Z-score
  const liqDirection = frliScore > 0.3 ? "Expanding" : frliScore < -0.3 ? "Contracting" : "Neutral";
  const liqArrow     = frliScore > 0.3 ? "up" : frliScore < -0.3 ? "down" : "flat";
  const liqDisplay   = liqArrow === "up" ? `${liqDirection} ▲`
                     : liqArrow === "down" ? `${liqDirection} ▼`
                     : liqDirection;

  // Historical QE comparison — thermometer scale
  const bsTotal   = data?.balanceSheetTotal ?? 0;
  const todayPct  = bsTotal > 0
    ? Math.min(110, Math.max(0, ((bsTotal - BS_BASELINE) / BS_RANGE) * 100))
    : 0;

  // ── Skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="w-full px-1 py-1 sm:px-0">
        <div className="pb-1 pt-0">
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
              aria-hidden="true"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              print
            </span>
            <div className="h-9 w-28 rounded bg-gray-100 dark:bg-gray-800 animate-pulse sm:h-10" />
          </div>
        </div>
        <div className="pt-2 pb-3.5 animate-pulse">
          <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="grid grid-cols-4 gap-1 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1 py-2.5">
              <div className="h-3 w-12 rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-3 w-8 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section className="w-full px-1 py-1 sm:px-0">
        <div className="pb-1 pt-0">
          <p className="flex items-center gap-2 text-3xl font-semibold leading-none text-gray-400 dark:text-gray-500 sm:text-4xl">
            <span
              className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
              aria-hidden="true"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              print
            </span>
            —
          </p>
        </div>
        <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
          {error ?? "No data available."}
        </div>
      </section>
    );
  }

  return (
    <section className="w-full px-1 py-1 sm:px-0">

      {/* ── Header: icon + DEFCON-style level number ──────────────────── */}
      <div className="pb-1 pt-0">
        <p className="flex items-center gap-2 text-3xl font-semibold leading-none text-white sm:text-4xl">
          <span
            className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
            aria-hidden="true"
            style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
          >
            print
          </span>
          <span className="tabular-nums">{data.frliLevel}</span>
          <span className="text-base font-normal text-gray-400 dark:text-gray-500 self-end mb-0.5">/5</span>
        </p>
      </div>

      {/* ── Gauge bar (printer rating 0–5) ─────────────────────────────── */}
      <div className="pt-2 pb-3.5">
        <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${displayedPct}%`,
              background: getCycleGradient(),
              backgroundSize: `${10000 / Math.max(displayedPct, 1)}% 100%`,
              backgroundPosition: "left center",
              backgroundRepeat: "no-repeat",
            }}
          />
          {/* Level tick marks on the bar */}
          {[1, 2, 3, 4].map((lvl) => (
            <div
              key={lvl}
              className="absolute top-0 h-2 w-px bg-gray-400/40 dark:bg-gray-500/40"
              style={{ left: `${(lvl / 5) * 100}%` }}
            />
          ))}
        </div>

        {/* Level number + label rows */}
        {(() => {
          const levels = [
            { n: 0, label: "Strong Tightening" },
            { n: 1, label: "Mild Tightening" },
            { n: 2, label: "Neutral" },
            { n: 3, label: "Mild Expansion" },
            { n: 4, label: "Active QE" },
            { n: 5, label: "Extreme Intervention" },
          ];
          return (
            <div className="relative mt-1 h-6">
              {levels.map(({ n, label }) => {
                const pct = (n / 5) * 100;
                const isActive = data.frliLevel === n;
                return (
                  <span
                    key={n}
                    className={`absolute flex flex-col items-center text-[9px] leading-tight whitespace-nowrap ${
                      n === 0 ? "items-start" : n === 5 ? "items-end" : "-translate-x-1/2"
                    } ${
                      isActive
                        ? "font-medium text-gray-600 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                    style={
                      n === 0
                        ? { left: 0 }
                        : n === 5
                          ? { right: 0 }
                          : { left: `${pct}%` }
                    }
                  >
                    <span className="tabular-nums">{n}</span>
                    <span className="text-[8px] hidden sm:inline">{label}</span>
                  </span>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* ── Fed Balance Sheet scale ───────────────────────────────── */}
      {bsTotal > 0 && (() => {
        const todayPctClamped = Math.min(Math.max(todayPct, 0), 100);
        const ticks = [
          { key: "2008",  pct: BS_2008_PCT,  label: "2008",  value: "(4.5T)" },
          { key: "today", pct: todayPctClamped, label: "Today", value: `(${bsTotal.toFixed(1)}T)`, highlight: true },
          { key: "covid", pct: BS_COVID_PCT, label: "2020",  value: "(8.9T)" },
        ].sort((a, b) => a.pct - b.pct);

        return (
          <div className="pb-3.5">
            {/* Gradient-filled track (same style as printer bar) */}
            <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${todayPctClamped}%`,
                  background: getCycleGradient(),
                  backgroundSize: `${10000 / Math.max(todayPctClamped, 1)}% 100%`,
                  backgroundPosition: "left center",
                  backgroundRepeat: "no-repeat",
                }}
              />
              {/* Tick marks on track */}
              {ticks.map((t) => (
                <div
                  key={t.key}
                  className={`absolute top-0 w-px ${
                    t.highlight ? "h-2 bg-white/70 dark:bg-white/50" : "h-2 bg-gray-400/50 dark:bg-gray-500/50"
                  }`}
                  style={{ left: `${t.pct}%` }}
                />
              ))}
            </div>

            {/* Top label row: 0T ... event names ... 30T */}
            <div className="relative h-3 mt-1">
              <span className="absolute left-0 text-[9px] tabular-nums text-gray-400 dark:text-gray-500">0T</span>
              {ticks.map((t) => (
                <span
                  key={t.key}
                  className={`absolute -translate-x-1/2 text-[9px] tabular-nums whitespace-nowrap ${
                    t.highlight
                      ? "font-medium text-gray-600 dark:text-gray-300"
                      : "text-gray-400 dark:text-gray-500"
                  }`}
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
              <span className="absolute right-0 text-[9px] tabular-nums text-gray-400 dark:text-gray-500">30T</span>
            </div>

            {/* Bottom label row: dollar values in parentheses */}
            <div className="relative h-3">
              {ticks.map((t) => (
                <span
                  key={t.key}
                  className={`absolute -translate-x-1/2 text-[9px] tabular-nums whitespace-nowrap ${
                    t.highlight
                      ? "font-medium text-gray-600 dark:text-gray-300"
                      : "text-gray-400 dark:text-gray-500"
                  }`}
                  style={{ left: `${t.pct}%` }}
                >
                  {t.value}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 4 Key Indicators ───────────────────────────────────────────── */}
      <div className="py-3">
        <div className="grid grid-cols-4 gap-1">
          <div>
            <MiniStat
              label="Fed Rate"
              value={fmtRate(fedRate)}
              active={fedRate !== null}
              valueColor="text-gray-800 dark:text-white/90"
              dotColor={fedRate !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}
              loading={false}
            />
          </div>
          <div>
            <MiniStat
              label="Rate Cut Prob"
              value={rateCut >= 0 ? `${rateCut}%` : "—"}
              active={rateCut >= 0}
              valueColor={rateCut >= 60 ? "text-orange-500 dark:text-orange-400" : "text-gray-800 dark:text-white/90"}
              dotColor={rateCut >= 60 ? "bg-orange-400" : rateCut >= 0 ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}
              loading={false}
            />
          </div>
          <div>
            <MiniStat
              label="M2 Growth"
              value={m2Display}
              active={m2Active}
              valueColor={
                m2Arrow === "up" ? "text-emerald-500 dark:text-emerald-400"
                : m2Arrow === "down" ? "text-red-400"
                : "text-gray-800 dark:text-white/90"
              }
              dotColor={
                m2Arrow === "up" ? "bg-emerald-400"
                : m2Arrow === "down" ? "bg-red-400"
                : "bg-gray-300 dark:bg-gray-600"
              }
              loading={false}
            />
          </div>
          <div>
            <MiniStat
              label="Money Supply"
              value={liqDisplay}
              active={data != null}
              valueColor={
                liqArrow === "up" ? "text-emerald-500 dark:text-emerald-400"
                : liqArrow === "down" ? "text-red-400"
                : "text-gray-800 dark:text-white/90"
              }
              dotColor={
                liqArrow === "up" ? "bg-emerald-400"
                : liqArrow === "down" ? "bg-red-400"
                : "bg-gray-300 dark:bg-gray-600"
              }
              loading={false}
            />
          </div>
        </div>
      </div>

    </section>
  );
}
