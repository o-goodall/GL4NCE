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

// ── Regime label helper ───────────────────────────────────────────────────
// All regime badges use the same neutral site colours; only the label text
// changes so the information is still surfaced without adding visual noise.
function regimeLabel(regime: string): string {
  return regime || "Normal";
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

  const scorePct = slideScore !== null ? Math.min(100, Math.max(0, slideScore)) : 0;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-7 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-5">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-800 shrink-0">
            <span className="text-gray-500 dark:text-gray-400 text-sm font-bold leading-none select-none">$</span>
          </div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Money Printer
          </h3>
        </div>
        {!loading && total > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums font-medium">
            {active + 1} / {total}
          </span>
        )}
      </div>

      {/* ── Slide area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {loading ? (
          /* Skeleton */
          <div className="flex-1 flex flex-col gap-4 animate-pulse">
            <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800" />
                </div>
                <div className="space-y-1 text-right">
                  <div className="h-8 w-12 rounded bg-gray-200 dark:bg-gray-700 ml-auto" />
                  <div className="h-2.5 w-8 rounded bg-gray-100 dark:bg-gray-800 ml-auto" />
                </div>
              </div>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3 space-y-2 border-t-2 border-t-gray-200 dark:border-t-gray-700">
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
            {/* ── Country identity card ── */}
            <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 p-4 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-5xl leading-none select-none">{c.flag}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-black text-gray-800 dark:text-white/90 leading-tight truncate">
                    {c.name}
                  </p>
                  {!c.error && slideScore !== null && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold mt-1 bg-gray-100 border-gray-200 text-gray-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-400 dark:bg-gray-500" />
                      {regimeLabel(slideRegime)}
                    </span>
                  )}
                </div>
                {!c.error && slideScore !== null && (
                  <div className="text-right shrink-0">
                    <span className="text-3xl font-black tabular-nums leading-none text-gray-800 dark:text-white/90">{slideScore}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 block mt-0.5 leading-none">/100</span>
                  </div>
                )}
              </div>

              {/* Printer score bar — site-accent amber fill, no glow */}
              {!c.error && slideScore !== null && (
                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 dark:bg-amber-500 transition-all duration-700"
                    style={{ width: `${scorePct}%` }}
                  />
                </div>
              )}
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {/* M2 */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3 border-t-2 border-t-gray-200 dark:border-t-gray-700">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
                  M2
                </p>
                <p className="text-sm font-black tabular-nums text-gray-800 dark:text-white/90">
                  {c.error ? "—" : fmtUSD(m2Current)}
                </p>
                {!c.error && (
                  <p className={`text-[11px] tabular-nums mt-0.5 font-medium ${
                    m2Change == null
                      ? "text-gray-400 dark:text-gray-500"
                      : m2Change < 0
                        ? "text-red-500 dark:text-red-400"
                        : "text-emerald-500 dark:text-emerald-400"
                  }`}>
                    {fmtDelta(m2Change)}
                  </p>
                )}
              </div>

              {/* M1 */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3 border-t-2 border-t-gray-200 dark:border-t-gray-700">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
                  M1
                </p>
                {c.error || c.m1DataMissing ? (
                  <p className="text-sm font-bold text-gray-400 dark:text-gray-500 italic">N/A</p>
                ) : (
                  <>
                    <p className="text-sm font-black tabular-nums text-gray-800 dark:text-white/90">
                      {fmtUSD(c.m1USD)}
                    </p>
                    <p className={`text-[11px] tabular-nums mt-0.5 font-medium ${
                      c.m1ChangeUSD == null
                        ? "text-gray-400 dark:text-gray-500"
                        : c.m1ChangeUSD < 0
                          ? "text-red-500 dark:text-red-400"
                          : "text-emerald-500 dark:text-emerald-400"
                    }`}>
                      {fmtDelta(c.m1ChangeUSD)}
                    </p>
                  </>
                )}
              </div>

              {/* Gross Debt */}
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3 border-t-2 border-t-gray-200 dark:border-t-gray-700">
                <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
                  Debt
                </p>
                <p className="text-sm font-black tabular-nums text-gray-800 dark:text-white/90">
                  {c.error ? "—" : fmtUSD(c.grossDebtUSD)}
                </p>
                {!c.error && c.debtToGDP != null && (
                  <p className="text-[11px] tabular-nums mt-0.5 font-medium text-gray-500 dark:text-gray-400">
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
