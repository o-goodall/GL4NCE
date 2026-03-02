import { useState, useEffect, useCallback, useRef } from "react";
import type { PulseData } from "./types";

export const PULSE_POLL_MINUTES = 10;

interface UsePulseReturn {
  data: PulseData | null;
  loading: boolean;
  error: string | null;
  /** Unix-ms timestamp of the next scheduled refresh */
  nextRefreshAt: number | null;
  /** Trigger an immediate refresh */
  refresh: () => void;
}

/**
 * Fetches pulse feed data from /api/pulse, polling every PULSE_POLL_MINUTES.
 * Falls back gracefully to an empty state (no mock data needed — Pulse is
 * not a critical safety feature like Flashpoint).
 */
export function usePulse(pollMinutes = PULSE_POLL_MINUTES): UsePulseReturn {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/pulse");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = (await resp.json()) as PulseData;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pulse feed");
    } finally {
      setLoading(false);
      setNextRefreshAt(Date.now() + pollMinutes * 60_000);
    }
  }, [pollMinutes]);

  useEffect(() => {
    setLoading(true);
    void load();
    timerRef.current = setInterval(() => { void load(); }, pollMinutes * 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { data, loading, error, nextRefreshAt, refresh };
}
