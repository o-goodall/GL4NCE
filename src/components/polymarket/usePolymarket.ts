import { useState, useEffect, useCallback, useRef } from "react";
import type { PolymarketData, PolymarketMarket } from "./types";

const POLL_MINUTES = 10;

interface UsePolymarketReturn {
  data: PolymarketData | null;
  loading: boolean;
  error: string | null;
  /** All currently loaded markets */
  markets: PolymarketMarket[];
}

/**
 * Fetches geopolitical Polymarket predictions from the server-side API route
 * (/api/polymarket) and polls every 10 minutes. Returns empty markets on error
 * so consumers degrade gracefully.
 */
export function usePolymarket(): UsePolymarketReturn {
  const [data, setData] = useState<PolymarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/polymarket");
      if (resp.ok) {
        const result = (await resp.json()) as PolymarketData;
        setData(result);
        setError(null);
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load market data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => { void load(); }, POLL_MINUTES * 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  return {
    data,
    loading,
    error,
    markets: data?.markets ?? [],
  };
}

/**
 * Returns markets whose question text mentions the given country name or its
 * common variants. Used to surface relevant predictions in the EventModal.
 */
export function filterMarketsForCountry(
  markets: PolymarketMarket[],
  countryName: string | null,
): PolymarketMarket[] {
  if (!countryName) return [];

  /** Country name → additional search terms (lower-case) */
  const VARIANTS: Record<string, string[]> = {
    "United States": ["usa", "u.s.", "america", "american"],
    "United Kingdom": ["uk", "britain", "british", "england", "london"],
    "Russia": ["russian", "moscow", "kremlin"],
    "Ukraine": ["ukrainian", "kyiv", "kiev"],
    "China": ["chinese", "beijing", "prc"],
    "Iran": ["iranian", "tehran"],
    "Israel": ["israeli", "tel aviv"],
    "Palestine": ["palestinian", "gaza", "west bank", "hamas"],
    "North Korea": ["dprk", "pyongyang"],
    "Taiwan": ["taiwanese"],
    "Syria": ["syrian", "damascus"],
    "Yemen": ["yemeni", "houthi"],
  };

  const terms = [
    countryName.toLowerCase(),
    ...(VARIANTS[countryName] ?? []),
  ];

  return markets.filter((m) => {
    const q = m.question.toLowerCase();
    return terms.some((t) => q.includes(t));
  });
}
