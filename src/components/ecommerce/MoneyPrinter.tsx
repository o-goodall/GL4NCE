import { useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";

// ── Types (mirror API responses) ──────────────────────────────────────────

interface CountryData {
  id:               string;
  name:             string;
  flag:             string;
  error:            boolean;
  latestUSD?:       number;
  printing?:        boolean;
  printedUSD?:      number | null;
  printedDate?:     string | null;
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
    case "Alert":   return { color: "text-orange-500 dark:text-orange-400", bg: "bg-orange-500"    };
    case "Warming": return { color: "text-yellow-500 dark:text-yellow-400", bg: "bg-yellow-500"    };
    default:        return { color: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-500" };
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtUSD(billions: number): string {
  const t = billions / 1_000;
  const str = t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
  return `$${str}T`;
}

function fmtDelta(billions: number): string {
  const abs = Math.abs(billions);
  const t   = abs / 1_000;
  const str = t >= 10 ? t.toFixed(1) : t >= 1 ? t.toFixed(2) : t.toFixed(3);
  return `+$${str}T`;
}

function fmtMonthYear(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
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

  // ── Skeleton rows ──────────────────────────────────────────────────────
  const skeletonRows = Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="w-6 h-5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse shrink-0" />
      <div className="w-9 h-3.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse shrink-0" />
      <div className="flex-1 flex flex-col gap-1">
        <div className="w-16 h-3.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="w-24 h-2.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
      <div className="w-10 h-5 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
    </div>
  ));

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 h-full flex flex-col">
      {/* Tile number badge */}
      <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
        6
      </span>

      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Money Printer
        </h3>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        M2 supply · balance sheet · credit stress · yield curve
      </p>

      {/* ── US Printer Score ───────────────────────────────────────────── */}
      <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
        {/* Score row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            US Printer Score
          </span>
          {loading ? (
            <div className="w-12 h-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : (
            <span className={`text-sm font-bold tabular-nums ${score !== null ? cfg.color : "text-gray-400"}`}>
              {score !== null ? `${score}/100` : "—"}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-2">
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
            <span className={`text-xs font-semibold ${score !== null ? cfg.color : "text-gray-400"}`}>
              {score !== null ? rg : "—"}
            </span>
          )}

          {!loading && printer?.indicators?.map((ind) => (
            <span
              key={ind.label}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${
                ind.elevated
                  ? "bg-orange-50 border-orange-200 text-orange-600 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400"
                  : "bg-gray-50 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              <span className={`w-1 h-1 rounded-full shrink-0 ${ind.elevated ? "bg-orange-400" : "bg-gray-300 dark:bg-gray-600"}`} />
              {ind.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── M2 per-country rows ────────────────────────────────────────── */}
      <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 flex-1 justify-around">
        {loading
          ? skeletonRows
          : countries.map((c: CountryData) => {
              const isOn = !c.error && c.printing === true;

              let subLabel: string | null = null;
              if (isOn && c.printedUSD != null) {
                subLabel = `${fmtDelta(c.printedUSD)} this month`;
              } else if (!c.error && !isOn && c.lastPrintedUSD != null && c.lastPrintedDate != null) {
                subLabel = `Last ${fmtDelta(c.lastPrintedUSD)} · ${fmtMonthYear(c.lastPrintedDate)}`;
              }

              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-lg leading-none select-none shrink-0">{c.flag}</span>

                  <span className="text-xs font-semibold text-gray-700 dark:text-white/80 w-9 shrink-0">
                    {c.name}
                  </span>

                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-sm font-medium tabular-nums text-gray-700 dark:text-gray-200 truncate">
                      {!c.error && c.latestUSD != null ? fmtUSD(c.latestUSD) : "—"}
                    </span>
                    {subLabel !== null && (
                      <span
                        className={`text-xs tabular-nums mt-0.5 leading-tight truncate ${
                          isOn
                            ? "text-emerald-500 dark:text-emerald-400"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        {subLabel}
                      </span>
                    )}
                  </div>

                  {c.error ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      —
                    </span>
                  ) : (
                    <Badge color={isOn ? "success" : "light"} size="sm">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          isOn
                            ? "bg-success-500 dark:bg-success-400"
                            : "bg-gray-400 dark:bg-gray-500"
                        }`}
                      />
                      {isOn ? "ON" : "OFF"}
                    </Badge>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}
