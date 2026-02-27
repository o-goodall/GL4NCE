import { useState, useEffect, useCallback, useRef } from "react";
import type { NewsMapData } from "./types";

const DEFAULT_POLL_MINUTES = 15;

interface UseNewsMapReturn {
  data: NewsMapData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches processed news-map data from the server-side API route (/api/news-map).
 * The API fetches RSS feeds server-side (no CORS issues) and aggregates events by
 * country, avoiding the rate-limit and CORS problems of client-side RSS fetching.
 * Falls back to client-side mock data (from newsProcessor) if the API is unavailable
 * (e.g. local dev without the Vercel runtime).
 */
export function useNewsMap(pollMinutes = DEFAULT_POLL_MINUTES): UseNewsMapReturn {
  const [data, setData] = useState<NewsMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      let result: NewsMapData;
      const resp = await fetch("/api/news-map");
      if (resp.ok) {
        result = (await resp.json()) as NewsMapData;
      } else {
        // API unavailable — fall back to client-side mock data
        const { generateMockData } = await import("./newsProcessor");
        result = generateMockData();
      }
      setData(result);
      setError(null);
    } catch (err) {
      // Network error — fall back to client-side mock data
      try {
        const { generateMockData } = await import("./newsProcessor");
        setData(generateMockData());
        setError(null);
      } catch {
        setError(err instanceof Error ? err.message : "Failed to load news data");
      }
    } finally {
      setLoading(false);
    }
  }, []); // setData/setError/setLoading are stable; no external dependencies

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => { void load(); }, pollMinutes * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, pollMinutes]);

  return { data, loading, error };
}
