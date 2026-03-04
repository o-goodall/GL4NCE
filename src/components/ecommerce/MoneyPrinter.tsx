import { useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";

// ── Types (mirror /api/m2 response) ──────────────────────────────────────────
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

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtUSD(billions: number): string {
  const t = billions / 1_000;
  const str = t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
  return `$${str}T`;
}

// Format a delta in billions USD as a compact "+$X.XT" string.
// M2 deltas displayed here are always positive growth; Math.abs guards
// against floating-point edge cases near zero.
function fmtDelta(billions: number): string {
  const abs = Math.abs(billions);
  const t   = abs / 1_000;
  const str = t >= 10 ? t.toFixed(1) : t >= 1 ? t.toFixed(2) : t.toFixed(3);
  return `+$${str}T`;
}

// Format an ISO date string (YYYY-MM-DD) as "MMM YYYY".
function fmtMonthYear(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MoneyPrinter() {
  const [countries, setCountries] = useState<CountryData[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/m2", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<M2Response>;
      })
      .then((json) => {
        setCountries(json.countries);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  // ── Skeleton rows ─────────────────────────────────────────────────────────
  const skeletonRows = Array.from({ length: 6 }, (_, i) => (
    <div
      key={i}
      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
    >
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
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
        M2 money supply · major economies · USD
      </p>

      {/* Country rows */}
      <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 flex-1 justify-around">
        {loading
          ? skeletonRows
          : countries.map((c: CountryData) => {
              const isOn = !c.error && c.printing === true;

              // Sub-label: amount printed this month (ON) or last printed info (OFF)
              let subLabel: string | null = null;
              if (isOn && c.printedUSD != null) {
                subLabel = `${fmtDelta(c.printedUSD)} this month`;
              } else if (!c.error && !isOn && c.lastPrintedUSD != null && c.lastPrintedDate != null) {
                subLabel = `Last ${fmtDelta(c.lastPrintedUSD)} · ${fmtMonthYear(c.lastPrintedDate)}`;
              }

              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  {/* Flag */}
                  <span className="text-lg leading-none select-none shrink-0">
                    {c.flag}
                  </span>

                  {/* Institution short name */}
                  <span className="text-xs font-semibold text-gray-700 dark:text-white/80 w-9 shrink-0">
                    {c.name}
                  </span>

                  {/* M2 total + sub-label */}
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

                  {/* ON / OFF badge */}
                  {c.error ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      —
                    </span>
                  ) : loading ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                      …
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

