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

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtRate(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}%`;
}

function fmtZ(z: number): string {
  const sign = z >= 0 ? "+" : "";
  return `${sign}${z.toFixed(2)}σ`;
}

function arrowChar(arrow: "up" | "down" | "flat"): string {
  if (arrow === "up") return "↑";
  if (arrow === "down") return "↓";
  return "→";
}

// ── Cycle-consistent gradient (matches BlockchainVisualizer / MonthlyTarget) ─

function getCycleGradient(): string {
  return "linear-gradient(to right, #FFD700, #FFC700, #FF8C00, #FF4500, #FF0000, #B22222, #CD5C5C, #E0FFFF)";
}

// ── Dot colour from Z-score ───────────────────────────────────────────────

function zDotColor(z: number): string {
  if (z > 1.0) return "bg-red-400";
  if (z > 0.3) return "bg-yellow-400";
  if (z > -0.3) return "bg-gray-300 dark:bg-gray-600";
  return "bg-blue-400";
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

  // Animate gauge bar on data load (matches ProgressRow pattern)
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

  const level = data.frliLevel;

  return (
    <section className="w-full px-1 py-1 sm:px-0">

      {/* ── Header: icon + regime name ─────────────────────────────────── */}
      <div className="pb-1 pt-0">
        <p className="flex items-center gap-2 text-3xl font-semibold leading-none text-white sm:text-4xl">
          <span
            className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
            aria-hidden="true"
            style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
          >
            print
          </span>
          {data.regime}
        </p>
      </div>

      {/* ── FRLI Gauge bar ─────────────────────────────────────────────── */}
      <div className="pt-2 pb-3.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              FRLI
            </span>
            <span className="text-[10px] tabular-nums font-medium text-gray-500 dark:text-gray-400">
              {level}/5
            </span>
          </div>
          <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
            {data.status}
          </span>
        </div>
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

      {/* ── Core FRLI metrics (4 Z-score indicators) ───────────────────── */}
      <div className="py-3">
        <div className="grid grid-cols-4 gap-1">
          {data.metrics.map((m) => (
            <div key={m.label} className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${zDotColor(m.zScore)}`} />
                <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">
                  {m.label}
                </span>
              </div>
              <span className="text-[10px] tabular-nums text-gray-800 dark:text-white/90">
                {fmtZ(m.zScore)} {arrowChar(m.arrow)}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-none">
                {m.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Interest Rates (display context) ───────────────────────────── */}
      <div className="py-3">
        <div className="grid grid-cols-3 gap-1">
          <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.rates.fedFunds !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}`} />
              <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">Fed Funds</span>
            </div>
            <span className="text-[10px] tabular-nums text-gray-800 dark:text-white/90">{fmtRate(data.rates.fedFunds)}</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.rates.yield2y !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}`} />
              <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">2Y Yield</span>
            </div>
            <span className="text-[10px] tabular-nums text-gray-800 dark:text-white/90">{fmtRate(data.rates.yield2y)}</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.rates.sofr !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}`} />
              <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">SOFR</span>
            </div>
            <span className="text-[10px] tabular-nums text-gray-800 dark:text-white/90">{fmtRate(data.rates.sofr)}</span>
            {data.rates.repoStress && (
              <span className="text-[10px] text-red-500 dark:text-red-400 leading-none">stress</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Polymarket Forward Signal ──────────────────────────────────── */}
      <div className="pb-3">
        <div className="grid grid-cols-2 gap-1">
          <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                data.forward.rateCutProb >= 60 ? "bg-orange-400" : data.forward.rateCutProb >= 0 ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"
              }`} />
              <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">Rate Cut</span>
            </div>
            <span className={`text-[10px] tabular-nums ${
              data.forward.rateCutProb >= 60
                ? "text-orange-500 dark:text-orange-400"
                : "text-gray-800 dark:text-white/90"
            }`}>
              {data.forward.rateCutProb >= 0 ? `${data.forward.rateCutProb}%` : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                data.forward.recessionProb >= 50 ? "bg-red-400" : data.forward.recessionProb >= 0 ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"
              }`} />
              <span className="text-[10px] font-semibold text-gray-800 dark:text-white/90 leading-tight">Recession</span>
            </div>
            <span className={`text-[10px] tabular-nums ${
              data.forward.recessionProb >= 50
                ? "text-red-500 dark:text-red-400"
                : "text-gray-800 dark:text-white/90"
            }`}>
              {data.forward.recessionProb >= 0 ? `${data.forward.recessionProb}%` : "—"}
            </span>
          </div>
        </div>
      </div>

    </section>
  );
}
