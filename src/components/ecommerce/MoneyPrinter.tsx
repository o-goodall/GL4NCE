import { useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";

// Balance sheet must grow by at least this percentage week-on-week to be "ON"
const EXPAND_THRESHOLD_PCT = 0.1;

// ── Central bank definitions ────────────────────────────────────────────────
interface Bank {
  id:      string;
  flag:    string;
  label:   string;  // Short label shown in the tile
  series:  string;  // FRED series ID
  symbol:  string;  // Currency symbol
  // Multiply raw FRED value by this factor to get the display number
  // (e.g. WALCL is in millions USD → factor 1e-6 → display in trillions)
  factor:  number;
  suffix:  string;  // Appended to display number ("T" = trillion, "B" = billion)
}

const BANKS: readonly Bank[] = [
  // WALCL: Fed H.4.1 weekly total assets, millions USD → display in T
  { id: "US", flag: "🇺🇸", label: "Fed", series: "WALCL",      symbol: "$",  factor: 1e-6, suffix: "T" },
  // ECBASSETSW: ECB Eurosystem weekly total assets, millions EUR → display in T
  { id: "EU", flag: "🇪🇺", label: "ECB", series: "ECBASSETSW", symbol: "€",  factor: 1e-6, suffix: "T" },
  // JPNASSETS: Bank of Japan total assets, trillions JPY → display in T
  { id: "JP", flag: "🇯🇵", label: "BOJ", series: "JPNASSETS",  symbol: "¥",  factor: 1,    suffix: "T" },
];

// ── State types ─────────────────────────────────────────────────────────────
type PrintStatus = "ON" | "OFF" | "loading" | "error";

interface BankState {
  value:  number | null;  // Raw latest FRED value (for display)
  status: PrintStatus;
  // Current week change (raw FRED units) — populated when status === "ON"
  change: number | null;
  // Date of the last expansion period (when status === "OFF")
  lastPrintedDate:   string | null;
  // Raw FRED change during last expansion period (when status === "OFF")
  lastPrintedAmount: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtValue(raw: number, bank: Bank): string {
  const v = raw * bank.factor;
  // Show one decimal for values under 100, otherwise zero decimals
  const str = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${bank.symbol}${str}${bank.suffix}`;
}

// Format a raw FRED delta as a compact "+$X.XT" string.
// Uses two decimal places for values under 1 to avoid "+$0.0T" for small changes.
function fmtChange(rawDelta: number, bank: Bank): string {
  const v = Math.abs(rawDelta) * bank.factor;
  const str = v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
  return `+${bank.symbol}${str}${bank.suffix}`;
}

// Format an ISO date string (YYYY-MM-DD) from FRED as "DD MMM YYYY".
function fmtDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

// ── FRED fetch ────────────────────────────────────────────────────────────────
interface FredResult {
  latest:            number;   // Raw FRED value of the latest observation
  status:            "ON" | "OFF";
  change:            number | null;  // Latest - prev (raw) when ON
  lastPrintedDate:   string | null;  // ISO date of last expansion when OFF
  lastPrintedAmount: number | null;  // Raw delta of last expansion when OFF
}

// Fetch the last 260 weekly observations for a series via the /api/fred proxy
// (which keeps the API key server-side and adds CDN caching).
async function fetchFredSeries(
  series: string,
  signal: AbortSignal,
): Promise<FredResult> {
  const url = `/api/fred?series=${encodeURIComponent(series)}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = (await res.json()) as {
    observations?: { date: string; value: string }[];
  };

  const obs = json.observations;
  if (!obs || obs.length < 2) throw new Error("Insufficient observations");

  // FRED uses "." for unreleased/provisional values — filter them out before processing.
  // This prevents a leading "." on the most-recent entry from aborting the scan entirely.
  const validObs = obs.filter((o) => {
    const v = parseFloat(o.value);
    return !isNaN(v) && v > 0;
  });

  if (validObs.length < 2) throw new Error("Insufficient valid observations");

  const latest = parseFloat(validObs[0].value);
  const prev   = parseFloat(validObs[1].value);

  const pctChange = ((latest - prev) / prev) * 100;
  const isOn = pctChange >= EXPAND_THRESHOLD_PCT;

  if (isOn) {
    return { latest, status: "ON", change: latest - prev, lastPrintedDate: null, lastPrintedAmount: null };
  }

  // Printer is currently OFF — scan back to find the most recent expansion week.
  let lastPrintedDate:   string | null = null;
  let lastPrintedAmount: number | null = null;

  for (let i = 1; i < validObs.length - 1; i++) {
    const v     = parseFloat(validObs[i].value);
    const vPrev = parseFloat(validObs[i + 1].value);
    const pct = ((v - vPrev) / vPrev) * 100;
    if (pct >= EXPAND_THRESHOLD_PCT) {
      lastPrintedDate   = validObs[i].date;
      lastPrintedAmount = v - vPrev;
      break;
    }
  }

  return { latest, status: "OFF", change: null, lastPrintedDate, lastPrintedAmount };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MoneyPrinter() {
  const [states, setStates] = useState<Record<string, BankState>>(
    () =>
      Object.fromEntries(
        BANKS.map((b) => [b.id, {
          value: null, status: "loading" as PrintStatus,
          change: null, lastPrintedDate: null, lastPrintedAmount: null,
        }]),
      ),
  );

  useEffect(() => {
    // Use an AbortController so in-flight fetches are cancelled if the
    // component unmounts before they complete, avoiding stale-state updates.
    const controller = new AbortController();

    // Fetch all banks in parallel; update each row independently as data arrives
    BANKS.forEach((bank) => {
      fetchFredSeries(bank.series, controller.signal)
        .then((result) => {
          setStates((s) => ({
            ...s,
            [bank.id]: {
              value:             result.latest,
              status:            result.status,
              change:            result.change,
              lastPrintedDate:   result.lastPrintedDate,
              lastPrintedAmount: result.lastPrintedAmount,
            },
          }));
        })
        .catch((err: unknown) => {
          // Ignore intentional cancellations on unmount
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStates((s) => ({
            ...s,
            [bank.id]: { value: null, status: "error", change: null, lastPrintedDate: null, lastPrintedAmount: null },
          }));
        });
    });

    return () => controller.abort();
  }, []);

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
        Central bank balance sheet expansion
      </p>

      {/* Central bank rows */}
      <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 flex-1 justify-around">
        {BANKS.map((bank) => {
          const s    = states[bank.id];
          const isOn = s.status === "ON";

          // Sub-label shown below the balance sheet total
          let subLabel: string | null = null;
          if (isOn && s.change !== null) {
            subLabel = `${fmtChange(s.change, bank)} this week`;
          } else if (s.status === "OFF" && s.lastPrintedDate !== null && s.lastPrintedAmount !== null) {
            subLabel = `Last ${fmtChange(s.lastPrintedAmount, bank)} · ${fmtDate(s.lastPrintedDate)}`;
          }

          return (
            <div
              key={bank.id}
              className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"
            >
              {/* Country flag */}
              <span className="text-xl leading-none select-none">
                {bank.flag}
              </span>

              {/* Bank short name */}
              <span className="text-sm font-semibold text-gray-700 dark:text-white/80 w-8 shrink-0">
                {bank.label}
              </span>

              {/* Balance sheet value + sub-label */}
              <div className="flex-1 flex flex-col">
                <span className="text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400">
                  {s.value !== null ? fmtValue(s.value, bank) : "—"}
                </span>
                {subLabel !== null && (
                  <span className={`text-xs tabular-nums mt-0.5 leading-tight ${
                    isOn
                      ? "text-emerald-500 dark:text-emerald-400"
                      : "text-gray-400 dark:text-gray-500"
                  }`}>
                    {subLabel}
                  </span>
                )}
              </div>

              {/* Status pill */}
              {s.status === "loading" ? (
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
