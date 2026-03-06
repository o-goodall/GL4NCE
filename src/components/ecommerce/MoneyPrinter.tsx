import { useEffect, useState } from "react";

// ── Types (mirror API responses) ──────────────────────────────────────────

interface CountryData {
  id:               string;
  name:             string;
  flag:             string;
  error:            boolean;
  // M1
  m1USD?:           number | null;
  m1ChangeUSD?:     number | null;
  m1DataMissing?:   boolean;
  // M2 / broad money
  m2USD?:           number | null;
  m2ChangeUSD?:     number | null;
  // Debt-to-GDP (World Bank, annual)
  debtToGDP?:       number | null;
  // Gross National Debt in current USD (annual, IMF WEO: debtToGDP% × nominal GDP)
  grossDebtUSD?:    number | null;
  // Per-bank Printer Score
  printerScore?:    number | null;
  scoreRegime?:     string | null;
  printing?:        boolean;
  // legacy fields (backward compat)
  latestUSD?:       number;
  printedUSD?:      number | null;
  lastPrintedDate?: string | null;
  lastPrintedUSD?:  number | null;
}

interface M2Response {
  countries: CountryData[];
}

interface PrinterIndicator {
  label:    string;
  value:    number;
  score:    number;
  weight:   number;
  elevated: boolean;
}

interface PrinterScore {
  score:      number;
  regime:     string;
  indicators: PrinterIndicator[];
}

// ── Regime config ─────────────────────────────────────────────────────────

interface RegimeConfig {
  color:  string;
  bg:     string;
}

function regimeCfg(regime: string): RegimeConfig {
  switch (regime) {
    case "Brrrr":   return { color: "text-red-500 dark:text-red-400",       bg: "bg-red-500"       };
    case "Alert":   return { color: "text-brand-800 dark:text-brand-200", bg: "bg-brand-500"    };
    case "Warming": return { color: "text-brand-800 dark:text-brand-200", bg: "bg-brand-500"    };
    default:        return { color: "text-success-700 dark:text-success-400", bg: "bg-success-500" };
  }
}

// ── Per-bank score badge styles (green → yellow → orange → red) ──────────────

const REGIME_BADGE: Record<string, { badge: string; dot: string }> = {
  Crisis: {
    badge: "bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400",
    dot:   "bg-red-500 dark:bg-red-400",
  },
  // "Brrrr" is the US printer.ts label for the top-of-tile score; map it to
  // the same Crisis style so the Fed row badge is consistent when overlaid.
  Brrrr: {
    badge: "bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400",
    dot:   "bg-red-500 dark:bg-red-400",
  },
  Alert: {
    badge: "bg-brand-50 border-brand-200 text-brand-800 dark:bg-brand-500/10 dark:border-brand-500/30 dark:text-brand-200",
    dot:   "bg-brand-500 dark:bg-brand-400",
  },
  Warming: {
    badge: "bg-brand-50 border-brand-200 text-brand-800 dark:bg-brand-500/10 dark:border-brand-500/30 dark:text-brand-200",
    dot:   "bg-brand-500 dark:bg-brand-400",
  },
  Normal: {
    badge: "bg-gray-50 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-gray-700 dark:text-gray-400",
    dot:   "bg-gray-400 dark:bg-gray-500",
  },
};

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtUSD(billions: number | null | undefined): string {
  if (billions == null) return "—";
  const t = billions / 1_000;
  const str = t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
  return `$${str}T`;
}

function fmtDelta(billions: number | null | undefined): string {
  if (billions == null) return "—";
  const sign = billions < 0 ? "-" : "+";
  const abs  = Math.abs(billions);
  const t    = abs / 1_000;
  const str  = t >= 10 ? t.toFixed(1) : t >= 1 ? t.toFixed(2) : t.toFixed(3);
  return `${sign}$${str}T`;
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}

// ── Component ─────────────────────────────────────────────────────────────
export default function MoneyPrinter() {
  const [countries, setCountries] = useState<CountryData[]>([]);
  const [printer,   setPrinter]   = useState<PrinterScore | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch("/api/m2",      { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`m2 ${r.status}`);      return r.json() as Promise<M2Response>; }),
      fetch("/api/printer", { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`printer ${r.status}`); return r.json() as Promise<PrinterScore>; }),
    ])
      .then(([m2Json, printerJson]) => {
        setCountries(m2Json.countries);
        setPrinter(printerJson);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const score = printer?.score  ?? null;
  const rg    = printer?.regime ?? "Normal";
  const cfg   = regimeCfg(rg);
  const pct   = score !== null ? Math.min(100, Math.max(0, score)) : 0;

  // ── Skeleton table rows ───────────────────────────────────────────────
  const skeletonRows = Array.from({ length: 6 }, (_, i) => (
    <tr key={i}>
      {Array.from({ length: 4 }, (__, j) => (
        <td key={j} className="py-2 md:py-3 pr-3 md:pr-4">
          <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" style={{ width: j === 0 ? "5rem" : "2.5rem" }} />
          {j === 3 && (
            <div className="h-2.5 mt-1 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" style={{ width: "1.75rem" }} />
          )}
        </td>
      ))}
    </tr>
  ));

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-7 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 md:mb-5">
        <h3 className="text-lg md:text-xl font-semibold text-gray-800 dark:text-white/90">
          Money Printer
        </h3>
      </div>

      {/* ── US Printer Score ───────────────────────────────────────────── */}
      <div className="mb-4 md:mb-5 pb-4 md:pb-5 border-b border-gray-100 dark:border-gray-800">
        {/* Score row */}
        <div className="flex items-center justify-between mb-2 md:mb-3">
          {loading ? (
            <div className="w-12 h-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : (
            <span className={`text-sm md:text-base font-bold tabular-nums ${score !== null ? cfg.color : "text-gray-400"}`}>
              {score !== null ? `${score}/100` : "—"}
            </span>
          )}
          <span className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            US Printer Score
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 md:h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-2 md:mb-3">
          {loading ? (
            <div className="h-full w-1/3 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
          ) : score !== null ? (
            <div
              className={`h-full rounded-full transition-all duration-700 ${cfg.bg}`}
              style={{ width: `${pct}%` }}
            />
          ) : null}
        </div>

        {/* Regime label + indicator pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {loading ? (
            <div className="w-20 h-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : (
            <span className={`text-xs md:text-sm font-semibold ${score !== null ? cfg.color : "text-gray-400"}`}>
              {score !== null ? rg : "—"}
            </span>
          )}

          {!loading && printer?.indicators?.map((ind) => (
            <span
              key={ind.label}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${
                ind.elevated
                  ? "bg-brand-50 border-brand-200 text-brand-800 dark:bg-brand-500/10 dark:border-brand-500/30 dark:text-brand-200"
                  : "bg-gray-50 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              <span className={`w-1 h-1 rounded-full shrink-0 ${ind.elevated ? "bg-brand-400" : "bg-gray-300 dark:bg-gray-600"}`} />
              {ind.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── M1 + M2 per-bank table ─────────────────────────────────────── */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] md:text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              <th className="text-left pb-2 md:pb-3 pr-3 md:pr-4">Bank</th>
              <th className="text-right pb-2 md:pb-3 pr-3 md:pr-4">M1</th>
              <th className="text-right pb-2 md:pb-3 pr-3 md:pr-4">M2</th>
              <th className="text-right pb-2 md:pb-3">Gross Debt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading
              ? skeletonRows
              : countries.map((c: CountryData) => {
                  const m2Current = c.m2USD ?? c.latestUSD ?? null;
                  const m2Change  = c.m2ChangeUSD ?? c.printedUSD ?? null;

                  const isUSWithPrinter = c.id === "US" && printer !== null;
                  const rowScore  = isUSWithPrinter ? printer!.score  : c.printerScore ?? 0;
                  const rowRegime = isUSWithPrinter ? printer!.regime : c.scoreRegime ?? "Normal";
                  const styles = REGIME_BADGE[rowRegime] ?? REGIME_BADGE.Normal;

                  // Debt-to-GDP colour: green ≤ 60 %, yellow 60–90 %, red > 90 %
                  const debtCls = c.debtToGDP == null
                    ? "text-gray-400 dark:text-gray-500"
                    : c.debtToGDP > 90
                      ? "text-red-500 dark:text-red-400"
                      : c.debtToGDP > 60
                        ? "text-brand-800 dark:text-brand-200"
                        : "text-emerald-500 dark:text-emerald-400";

                  return (
                    <tr key={c.id}>
                      {/* Bank + Score badge */}
                      <td className="py-2 md:py-3 pr-3 md:pr-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {!c.error && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium shrink-0 ${styles.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} />
                              {rowScore}/100
                            </span>
                          )}
                          <span className="text-base md:text-lg leading-none select-none">{c.flag}</span>
                          <span className="text-xs md:text-sm font-semibold text-gray-700 dark:text-white/80">{c.name}</span>
                        </div>
                      </td>

                      {/* M1 current + Δ stacked */}
                      <td className="py-2 md:py-3 pr-3 md:pr-4 text-right">
                        <div className="text-xs md:text-sm tabular-nums text-gray-700 dark:text-gray-200">
                          {c.error ? "—" : c.m1DataMissing ? (
                          <span className="text-gray-400 dark:text-gray-500 italic">N/A</span>
                          ) : fmtUSD(c.m1USD)}
                        </div>
                        {!c.error && !c.m1DataMissing && (
                          <div className={`text-[10px] md:text-xs tabular-nums ${
                            c.m1ChangeUSD == null
                              ? "text-gray-400 dark:text-gray-500"
                              : c.m1ChangeUSD < 0
                                ? "text-red-400 dark:text-red-400"
                                : "text-emerald-500 dark:text-emerald-400"
                          }`}>
                            {fmtDelta(c.m1ChangeUSD)}
                          </div>
                        )}
                      </td>

                      {/* M2 current + Δ stacked */}
                      <td className="py-2 md:py-3 pr-3 md:pr-4 text-right">
                        <div className="text-xs md:text-sm tabular-nums text-gray-700 dark:text-gray-200">
                          {c.error ? "—" : fmtUSD(m2Current)}
                        </div>
                        {!c.error && (
                          <div className={`text-[10px] md:text-xs tabular-nums ${
                            m2Change == null
                              ? "text-gray-400 dark:text-gray-500"
                              : m2Change < 0
                                ? "text-red-400 dark:text-red-400"
                                : "text-emerald-500 dark:text-emerald-400"
                          }`}>
                            {fmtDelta(m2Change)}
                          </div>
                        )}
                      </td>

                      {/* Gross Debt (USD) + Debt/GDP % stacked */}
                      <td className="py-2 md:py-3 text-right">
                        <div className="text-xs md:text-sm tabular-nums text-gray-700 dark:text-gray-200">
                          {c.error ? "—" : fmtUSD(c.grossDebtUSD)}
                        </div>
                        {!c.error && c.debtToGDP != null && (
                          <div className={`text-[10px] md:text-xs tabular-nums ${debtCls}`}>
                            {fmtPct(c.debtToGDP)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
