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

// ── Fed Balance Sheet thermometer scale constants ───────────────────────
// Scale: baseline ($0.9T) → ceiling ($20T) to leave room for the next big print
const BS_BASELINE   = 0.9;    // ~$0.9T pre-2008
const BS_2008_PEAK  = 4.5;    // ~$4.5T post-GFC          (+3.6T)
const BS_COVID_PEAK = 8.9;    // ~$8.9T COVID peak         (+4.4T from pre-COVID $4.1T→$8.9T ≈ +5T)
const BS_CEILING    = 20;     // $20T — leaves headroom for +$7–10T next crisis
const BS_RANGE      = BS_CEILING - BS_BASELINE;  // 19.1T
const BS_2008_PCT   = ((BS_2008_PEAK - BS_BASELINE) / BS_RANGE) * 100;   // ~18.8%
const BS_COVID_PCT  = ((BS_COVID_PEAK - BS_BASELINE) / BS_RANGE) * 100;  // ~41.9%
const BS_NEXT_PCT   = 100; // right edge = ceiling

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

      {/* ── Gauge bar (no labels — level implied by fill) ──────────────── */}
      <div className="pt-2 pb-3.5">
        <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
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
        </div>
      </div>

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

      {/* ── Fed Balance Sheet thermometer ───────────────────────────── */}
      {bsTotal > 0 && (
        <div className="pb-3">
          {/* Track */}
          <div className="relative h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-visible">
            {/* Faded "next crisis" zone from COVID to end */}
            <div
              className="absolute inset-y-0 rounded-full opacity-30"
              style={{
                left: `${BS_COVID_PCT}%`,
                width: `${BS_NEXT_PCT - BS_COVID_PCT}%`,
                background: "repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(156,163,175,0.25) 3px, rgba(156,163,175,0.25) 6px)",
              }}
            />

            {/* Fill up to today */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gray-300 dark:bg-gray-600 transition-all duration-700"
              style={{ width: `${Math.min(todayPct, 100)}%` }}
            />

            {/* 2008 marker */}
            <div
              className="absolute top-0 h-1.5 w-px bg-gray-400 dark:bg-gray-500"
              style={{ left: `${BS_2008_PCT}%` }}
            />

            {/* COVID marker */}
            <div
              className="absolute top-0 h-1.5 w-px bg-gray-400 dark:bg-gray-500"
              style={{ left: `${BS_COVID_PCT}%` }}
            />

            {/* Today triangle marker */}
            <div
              className="absolute -top-2.5 -translate-x-1/2 text-[9px] leading-none text-gray-400 dark:text-gray-500"
              style={{ left: `${Math.min(todayPct, 100)}%` }}
            >
              ▲
            </div>
          </div>

          {/* Labels row */}
          <div className="relative mt-1 h-4">
            {/* 0 */}
            <span className="absolute left-0 text-[9px] tabular-nums text-gray-400 dark:text-gray-500">0</span>

            {/* 2008 */}
            <span
              className="absolute -translate-x-1/2 text-[9px] tabular-nums text-gray-400 dark:text-gray-500 whitespace-nowrap"
              style={{ left: `${BS_2008_PCT}%` }}
            >
              2008 (+3.6T)
            </span>

            {/* COVID */}
            <span
              className="absolute -translate-x-1/2 text-[9px] tabular-nums text-gray-400 dark:text-gray-500 whitespace-nowrap"
              style={{ left: `${BS_COVID_PCT}%` }}
            >
              COVID (+5T)
            </span>

            {/* Next Crisis */}
            <span
              className="absolute text-[9px] tabular-nums text-gray-400/60 dark:text-gray-600 whitespace-nowrap"
              style={{ right: 0 }}
            >
              Next?
            </span>
          </div>

          {/* Today label below marker */}
          <div className="relative h-3">
            <span
              className="absolute -translate-x-1/2 text-[9px] font-medium tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap"
              style={{ left: `${Math.min(todayPct, 100)}%` }}
            >
              Today (${bsTotal.toFixed(1)}T)
            </span>
          </div>

          <div className="text-[9px] text-gray-400 dark:text-gray-500 text-center mt-0.5">
            Fed balance sheet size (trillions USD)
          </div>
        </div>
      )}

    </section>
  );
}
