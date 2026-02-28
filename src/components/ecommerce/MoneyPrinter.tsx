import { useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";

// ── FRED API configuration ──────────────────────────────────────────────────
const FRED_API_KEY   = "6890f3185ca5ad2a4620da6b9ae832cb";
const FRED_BASE_URL  = "https://api.stlouisfed.org/fred/series/observations";

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
  // RNUASSET: Bank of Japan weekly total assets, billions JPY → display in T
  { id: "JP", flag: "🇯🇵", label: "BOJ", series: "RNUASSET",   symbol: "¥",  factor: 1e-3, suffix: "T" },
  // BOEBSTAR: Bank of England sterling assets, millions GBP → display in T
  { id: "GB", flag: "🇬🇧", label: "BoE", series: "BOEBSTAR",   symbol: "£",  factor: 1e-6, suffix: "T" },
  // WCASGDPDSAB: Bank of Canada total assets, billions CAD → display in B
  { id: "CA", flag: "🇨🇦", label: "BoC", series: "WCASGDPDSAB", symbol: "C$", factor: 1,    suffix: "B" },
];

// ── State types ─────────────────────────────────────────────────────────────
type PrintStatus = "ON" | "OFF" | "loading" | "error";

interface BankState {
  value:  number | null;  // Raw latest FRED value (for display)
  status: PrintStatus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtValue(raw: number, bank: Bank): string {
  const v = raw * bank.factor;
  // Show one decimal for values under 100, otherwise zero decimals
  const str = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${bank.symbol}${str}${bank.suffix}`;
}

// Fetch the two most recent observations for a FRED series.
// Returns { latest, prev } as numbers (raw FRED units).
async function fetchFredSeries(
  series: string,
  signal: AbortSignal,
): Promise<{ latest: number; prev: number }> {
  const url =
    `${FRED_BASE_URL}` +
    `?series_id=${encodeURIComponent(series)}` +
    `&api_key=${FRED_API_KEY}` +
    `&limit=2&sort_order=desc&file_type=json`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = (await res.json()) as {
    observations?: { date: string; value: string }[];
  };

  const obs = json.observations;
  if (!obs || obs.length < 2) throw new Error("Insufficient observations");

  const latest = parseFloat(obs[0].value);
  const prev   = parseFloat(obs[1].value);

  // FRED uses "." for missing values; treat as invalid.
  // prev must be non-zero to compute a meaningful percentage change.
  if (isNaN(latest) || isNaN(prev) || prev === 0)
    throw new Error("Invalid, missing, or zero previous value");

  return { latest, prev };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MoneyPrinter() {
  const [states, setStates] = useState<Record<string, BankState>>(
    () =>
      Object.fromEntries(
        BANKS.map((b) => [b.id, { value: null, status: "loading" as PrintStatus }]),
      ),
  );

  useEffect(() => {
    // Use an AbortController so in-flight fetches are cancelled if the
    // component unmounts before they complete, avoiding stale-state updates.
    const controller = new AbortController();

    // Fetch all banks in parallel; update each row independently as data arrives
    BANKS.forEach((bank) => {
      fetchFredSeries(bank.series, controller.signal)
        .then(({ latest, prev }) => {
          const pctChange = ((latest - prev) / prev) * 100;
          const status: PrintStatus =
            pctChange >= EXPAND_THRESHOLD_PCT ? "ON" : "OFF";
          setStates((s) => ({
            ...s,
            [bank.id]: { value: latest, status },
          }));
        })
        .catch((err: unknown) => {
          // Ignore intentional cancellations on unmount
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStates((s) => ({
            ...s,
            [bank.id]: { value: null, status: "error" },
          }));
        });
    });

    return () => controller.abort();
  }, []);

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      {/* Tile number badge */}
      <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        2
      </span>

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className="w-5 h-5 flex items-center justify-center text-base leading-none"
          aria-label="Money printer"
        >
          🖨️
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Money Printer
        </span>
      </div>

      {/* Central bank rows */}
      <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
        {BANKS.map((bank) => {
          const s   = states[bank.id];
          const isOn = s.status === "ON";

          return (
            <div
              key={bank.id}
              className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
            >
              {/* Country flag */}
              <span className="text-base leading-none select-none">
                {bank.flag}
              </span>

              {/* Bank short name */}
              <span className="text-xs font-semibold text-gray-700 dark:text-white/80 w-7 shrink-0">
                {bank.label}
              </span>

              {/* Balance sheet value */}
              <span className="flex-1 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                {s.value !== null ? fmtValue(s.value, bank) : "—"}
              </span>

              {/* Status pill */}
              {s.status === "loading" ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
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
