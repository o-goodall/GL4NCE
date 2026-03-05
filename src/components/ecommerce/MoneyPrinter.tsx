import { useCallback, useEffect, useRef, useState } from "react";

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

interface PrinterScore {
  score:      number;
  regime:     string;
}

// ── Constants ─────────────────────────────────────────────────────────────
/** Auto-advance interval (ms) — slower than Polymarket's 5 s */
const AUTO_SLIDE_MS = 7_000;

// ── Regime styles ─────────────────────────────────────────────────────────

interface RegimeStyle {
  color:  string;
  bg:     string;
  badge:  string;
  dot:    string;
}

function regimeStyle(regime: string): RegimeStyle {
  switch (regime) {
    case "Brrrr":
    case "Crisis":
      return {
        color: "text-red-500 dark:text-red-400",
        bg:    "bg-red-500",
        badge: "bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400",
        dot:   "bg-red-500 dark:bg-red-400",
      };
    case "Alert":
      return {
        color: "text-orange-500 dark:text-orange-400",
        bg:    "bg-orange-500",
        badge: "bg-orange-50 border-orange-200 text-orange-600 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400",
        dot:   "bg-orange-500 dark:bg-orange-400",
      };
    case "Warming":
      return {
        color: "text-yellow-500 dark:text-yellow-400",
        bg:    "bg-yellow-500",
        badge: "bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-500/10 dark:border-yellow-500/30 dark:text-yellow-300",
        dot:   "bg-yellow-500 dark:bg-yellow-400",
      };
    default:
      return {
        color: "text-emerald-500 dark:text-emerald-400",
        bg:    "bg-emerald-500",
        badge: "bg-gray-50 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-gray-700 dark:text-gray-400",
        dot:   "bg-gray-400 dark:bg-gray-500",
      };
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtUSD(billions: number | null | undefined): string {
  if (billions == null) return "—";
  const t = billions / 1_000;
  const str = t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
  return `$${str}T`;
}

function fmtDelta(billions: number | null | undefined): string {
  if (billions == null) return "—";
  const sign = billions < 0 ? "−" : "+";
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
  const [active,    setActive]    = useState(0);

  // ── Data fetch ────────────────────────────────────────────────────────
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

  // ── Carousel auto-advance ─────────────────────────────────────────────
  const total       = countries.length;
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number) => {
    if (total === 0) return;
    setActive(((idx % total) + total) % total);
  }, [total]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive((prev: number) => (prev + 1) % (total || 1));
    }, AUTO_SLIDE_MS);
  }, [total]);

  useEffect(() => {
    if (loading || total === 0) return;
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, total, startTimer]);

  // ── Derived slide data ────────────────────────────────────────────────
  const c = countries[active] ?? null;

  const m2Current = c ? (c.m2USD ?? c.latestUSD ?? null) : null;
  const m2Change  = c ? (c.m2ChangeUSD ?? c.printedUSD ?? null) : null;

  const isUSWithPrinter = c?.id === "US" && printer !== null;
  const slideScore  = isUSWithPrinter ? printer!.score  : (c?.printerScore ?? null);
  const slideRegime = isUSWithPrinter ? printer!.regime : (c?.scoreRegime ?? "Normal");
  const rs          = regimeStyle(slideRegime);

  const debtCls = c?.debtToGDP == null
    ? "text-gray-400 dark:text-gray-500"
    : c.debtToGDP > 90
      ? "text-red-500 dark:text-red-400"
      : c.debtToGDP > 60
        ? "text-yellow-500 dark:text-yellow-300"
        : "text-emerald-500 dark:text-emerald-400";

  const scorePct = slideScore !== null ? Math.min(100, Math.max(0, slideScore)) : 0;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-7 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-5">
        <h3 className="text-lg md:text-xl font-semibold text-gray-800 dark:text-white/90">
          Money Printer
        </h3>
        {!loading && total > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {active + 1} / {total}
          </span>
        )}
      </div>

      {/* ── Slide area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {loading ? (
          /* Skeleton */
          <div className="flex-1 flex flex-col gap-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-32 rounded bg-gray-100 dark:bg-gray-800" />
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            </div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800" />
            <div className="grid grid-cols-3 gap-3 mt-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3 space-y-2">
                  <div className="h-2.5 w-10 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-4 w-14 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-10 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
              ))}
            </div>
          </div>
        ) : c === null ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            No data available
          </div>
        ) : (
          <>
            {/* Country identity */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl leading-none select-none">{c.flag}</span>
              <div className="min-w-0">
                <p className="text-base md:text-lg font-bold text-gray-800 dark:text-white/90 leading-tight">
                  {c.name}
                </p>
                {!c.error && slideScore !== null && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold mt-1 ${rs.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${rs.dot}`} />
                    {slideRegime} · {slideScore}/100
                  </span>
                )}
              </div>
            </div>

            {/* Printer score bar */}
            {!c.error && slideScore !== null && (
              <div className="mb-4">
                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${rs.bg}`}
                    style={{ width: `${scorePct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Metric cards */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {/* M2 */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                  M2
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-800 dark:text-white/90">
                  {c.error ? "—" : fmtUSD(m2Current)}
                </p>
                {!c.error && (
                  <p className={`text-[11px] tabular-nums mt-0.5 ${
                    m2Change == null
                      ? "text-gray-400 dark:text-gray-500"
                      : m2Change < 0
                        ? "text-red-400"
                        : "text-emerald-500 dark:text-emerald-400"
                  }`}>
                    {fmtDelta(m2Change)}
                  </p>
                )}
              </div>

              {/* M1 */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                  M1
                </p>
                {c.error || c.m1DataMissing ? (
                  <p className="text-sm font-bold text-gray-400 dark:text-gray-500 italic">N/A</p>
                ) : (
                  <>
                    <p className="text-sm font-bold tabular-nums text-gray-800 dark:text-white/90">
                      {fmtUSD(c.m1USD)}
                    </p>
                    <p className={`text-[11px] tabular-nums mt-0.5 ${
                      c.m1ChangeUSD == null
                        ? "text-gray-400 dark:text-gray-500"
                        : c.m1ChangeUSD < 0
                          ? "text-red-400"
                          : "text-emerald-500 dark:text-emerald-400"
                    }`}>
                      {fmtDelta(c.m1ChangeUSD)}
                    </p>
                  </>
                )}
              </div>

              {/* Gross Debt */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                  Debt
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-800 dark:text-white/90">
                  {c.error ? "—" : fmtUSD(c.grossDebtUSD)}
                </p>
                {!c.error && c.debtToGDP != null && (
                  <p className={`text-[11px] tabular-nums mt-0.5 ${debtCls}`}>
                    {fmtPct(c.debtToGDP)} GDP
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Navigation ────────────────────────────────────────────────── */}
      {!loading && total > 1 && (
        <div className="mt-4 md:mt-5 flex items-center justify-between gap-2">
          {/* Prev */}
          <button
            onClick={() => { goTo(active - 1); startTimer(); }}
            aria-label="Previous country"
            className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5 overflow-hidden flex-1 justify-center">
            {countries.map((_: CountryData, i: number) => (
              <button
                key={i}
                onClick={() => { goTo(i); startTimer(); }}
                aria-label={`Go to ${countries[i].name}`}
                aria-current={i === active ? "true" : undefined}
                className={`rounded-full transition-all duration-300 shrink-0 ${
                  i === active
                    ? "w-4 h-1.5 bg-gray-700 dark:bg-gray-300"
                    : "w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500"
                }`}
              />
            ))}
          </div>

          {/* Next */}
          <button
            onClick={() => { goTo(active + 1); startTimer(); }}
            aria-label="Next country"
            className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
