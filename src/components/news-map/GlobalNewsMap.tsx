import { useMemo, useState, useEffect } from "react";
import Badge from "../ui/badge/Badge";
import { useNewsMap } from "./useNewsMap";
import { countryFlag } from "./mapUtils";
import type { AlertLevel, CountryNewsData } from "./types";

/** Counts down to a target timestamp, returning seconds remaining (updates every second). */
function useCountdownSeconds(targetMs: number | null): number | null {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (targetMs === null) { setSecsLeft(null); return; }
    const tick = () => setSecsLeft(Math.max(0, Math.round((targetMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return secsLeft;
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Visual priority order for sorting (lower index = more urgent) */
const ALERT_ORDER: Record<AlertLevel, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  watch:    3,
};

const ALERT_BADGE_COLOR: Record<AlertLevel, "error" | "warning" | "primary" | "light"> = {
  critical: "error",
  high:     "warning",
  medium:   "primary",
  watch:    "light",
};

const ALERT_LABEL: Record<AlertLevel, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  watch:    "Watch",
};

const MAX_ROWS = 10;

function SkeletonRow() {
  return (
    <tr>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          <div className="w-24 h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
      </td>
      <td className="py-3 pr-4">
        <div className="w-14 h-5 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </td>
      <td className="py-3 pr-4">
        <div className="w-6 h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </td>
      <td className="py-3">
        <div className="w-full h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </td>
    </tr>
  );
}

function CountryRow({ country }: { country: CountryNewsData }) {
  const topEvent = country.events[0];
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none" aria-label={country.name}>
            {countryFlag(country.code)}
          </span>
          <span className="text-sm font-medium text-gray-800 dark:text-white/90 truncate max-w-[120px]">
            {country.name}
          </span>
          {country.trending && (
            <span className="shrink-0 text-[10px] font-semibold text-brand-500 dark:text-brand-400">
              ▲
            </span>
          )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <Badge size="sm" color={ALERT_BADGE_COLOR[country.alertLevel]}>
          {ALERT_LABEL[country.alertLevel]}
        </Badge>
      </td>
      <td className="py-3 pr-4 text-sm tabular-nums text-gray-500 dark:text-gray-400">
        {country.events.length}
      </td>
      <td className="py-3">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate block max-w-[260px]">
          {topEvent?.title ?? "—"}
        </span>
      </td>
    </tr>
  );
}

export default function GlobalNewsMap() {
  const { data, loading, nextRefreshAt, refresh } = useNewsMap();
  const secsLeft = useCountdownSeconds(nextRefreshAt);

  const topCountries = useMemo<CountryNewsData[]>(() => {
    if (!data) return [];
    return [...data.countries]
      .sort((a, b) => {
        const alertDiff = ALERT_ORDER[a.alertLevel] - ALERT_ORDER[b.alertLevel];
        if (alertDiff !== 0) return alertDiff;
        return b.events.length - a.events.length;
      })
      .slice(0, MAX_ROWS);
  }, [data]);

  const updatedAt = data && !data.usingMockData
    ? new Date(data.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const countdownText = loading
    ? "refreshing…"
    : secsLeft !== null
    ? `next refresh in ${formatCountdown(secsLeft)}`
    : null;

  const statusParts: string[] = [];
  if (updatedAt) statusParts.push(`updated ${updatedAt}`);
  if (countdownText) statusParts.push(countdownText);
  const statusText = data
    ? data.usingMockData
      ? "Demo data"
      : statusParts.join(" · ")
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            6
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Flashpoints
          </h3>
        </div>
        {statusText && (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            title="Refresh now"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`w-3 h-3 shrink-0 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75V6.75a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1 0-1.5h2.44l-.963-.963A5.25 5.25 0 0 0 2.91 6.59a.75.75 0 0 1-1.455-.36A6.75 6.75 0 0 1 12.9 4.215l.936.937V3.227a.75.75 0 0 1 .75-.75ZM2.164 9.5a.75.75 0 0 1 .75.75v1.51l.936-.937a6.75 6.75 0 0 1 11.445-1.635.75.75 0 0 1-1.455.36 5.25 5.25 0 0 0-8.317-1.553l-.963.963h2.44a.75.75 0 0 1 0 1.5H3.164a.75.75 0 0 1-.75-.75V9.5z" clipRule="evenodd" />
            </svg>
            {statusText}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              <th className="py-3 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Country
              </th>
              <th className="py-3 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Alert
              </th>
              <th className="py-3 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Events
              </th>
              <th className="py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Latest Story
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: MAX_ROWS }, (_, i) => <SkeletonRow key={i} />)
              : topCountries.length > 0
              ? topCountries.map((c) => <CountryRow key={c.code} country={c} />)
              : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No active events
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
