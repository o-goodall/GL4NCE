import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import Badge from "../ui/badge/Badge";

// ── Alert thresholds ──────────────────────────────────────────────────────────
// Mirror the server-side thresholds so the UI tooltip text stays in sync.
const MOM_ALERT_PCT = 1.0;   // > 1 % MoM  → alert
const YOY_ALERT_PCT = 8.0;   // > 8 % YoY  → alert

// ── Sparkline colours (one per country, same order as API response) ───────────
const SPARK_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#F97316"];

// ── Types (mirror /api/m2 response) ──────────────────────────────────────────
interface HistoryPoint {
  date:     string;
  valueUSD: number; // billions USD
}

interface CountryData {
  id:        string;
  name:      string;
  flag:      string;
  error:     boolean;
  latestUSD?: number;
  momPct?:   number | null;
  yoyPct?:   number | null;
  alert?:    boolean;
  history?:  HistoryPoint[];
}

interface M2Response {
  countries: CountryData[];
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtUSD(billions: number): string {
  const t = billions / 1_000; // convert billions → trillions
  const str = t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
  return `$${str}T`;
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
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

  // ── Sparkline (12-month trend indexed to 100) ─────────────────────────────
  const sparkSeries = countries
    .filter((c: CountryData) => !c.error && c.history && c.history.length > 1)
    .map((c: CountryData) => {
      const base = c.history![0].valueUSD;
      return {
        name: c.name,
        data: c.history!.map((h: HistoryPoint) => ({
          x: h.date,
          y: base > 0 ? parseFloat(((h.valueUSD / base) * 100).toFixed(2)) : 100,
        })),
      };
    });

  const sparkOptions: ApexOptions = {
    chart: {
      type: "line",
      height: 64,
      sparkline: { enabled: true },
      animations: { enabled: false },
    },
    stroke: { width: 1.5, curve: "smooth" },
    tooltip: {
      enabled: true,
      shared: true,
      x: { show: true },
      y: {
        formatter: (val: number) => `${val.toFixed(1)}`,
      },
    },
    colors: SPARK_COLORS,
    legend: { show: false },
  };

  // ── Skeleton rows ─────────────────────────────────────────────────────────
  const skeletonRows = Array.from({ length: 6 }, (_, i) => (
    <div
      key={i}
      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
    >
      <div className="w-6 h-5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse shrink-0" />
      <div className="w-9 h-3.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse shrink-0" />
      <div className="flex-1 flex flex-col gap-1">
        <div className="w-16 h-3.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="w-20 h-2.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
      <div className="w-10 h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
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
        M2 money supply · major economies · USD
      </p>

      {/* Country rows */}
      <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 flex-1 justify-around">
        {loading
          ? skeletonRows
          : countries.map((c: CountryData) => {
              const isAlert = !c.error && c.alert;

              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  {/* Flag */}
                  <span className="text-lg leading-none select-none shrink-0">
                    {c.flag}
                  </span>

                  {/* Institution short name */}
                  <span className="text-xs font-semibold text-gray-700 dark:text-white/80 w-9 shrink-0">
                    {c.name}
                  </span>

                  {/* M2 value + YoY sub-label */}
                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-sm font-medium tabular-nums text-gray-700 dark:text-gray-200 truncate">
                      {!c.error && c.latestUSD != null
                        ? fmtUSD(c.latestUSD)
                        : "—"}
                    </span>
                    {!c.error && c.yoyPct != null && (
                      <span
                        className={`text-xs tabular-nums mt-0.5 leading-tight ${
                          c.yoyPct > YOY_ALERT_PCT
                            ? "text-red-500 dark:text-red-400"
                            : c.yoyPct > 0
                            ? "text-emerald-500 dark:text-emerald-400"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        {fmtPct(c.yoyPct)} YoY
                      </span>
                    )}
                  </div>

                  {/* MoM change */}
                  {!c.error && c.momPct != null ? (
                    <span
                      className={`text-xs tabular-nums font-medium shrink-0 ${
                        c.momPct > MOM_ALERT_PCT
                          ? "text-red-500 dark:text-red-400"
                          : c.momPct > 0
                          ? "text-emerald-500 dark:text-emerald-400"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {fmtPct(c.momPct)}
                    </span>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}

                  {/* Status / alert badge */}
                  {c.error ? (
                    <Badge color="light" size="sm">—</Badge>
                  ) : (
                    <Badge color={isAlert ? "error" : "success"} size="sm">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          isAlert
                            ? "bg-red-500 dark:bg-red-400"
                            : "bg-success-500 dark:bg-success-400"
                        }`}
                      />
                      {isAlert ? "↑↑" : "OK"}
                    </Badge>
                  )}
                </div>
              );
            })}
      </div>

      {/* 12-month trend sparkline */}
      {!loading && sparkSeries.length > 0 && (
        <div className="mt-4 -mx-1 border-t border-gray-100 dark:border-gray-800 pt-3">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 px-1">
            12-month M2 trend · indexed to 100
          </p>
          <Chart
            options={sparkOptions}
            series={sparkSeries}
            type="line"
            height={64}
          />
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 px-1">
            {countries
              .filter((c: CountryData) => !c.error)
              .map((c: CountryData, i: number) => (
                <span
                  key={c.id}
                  className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                >
                  <span
                    className="inline-block w-2.5 h-0.5 rounded-full"
                    style={{ backgroundColor: SPARK_COLORS[i] }}
                  />
                  {c.name}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

