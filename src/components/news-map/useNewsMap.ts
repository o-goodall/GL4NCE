import { useState, useEffect, useRef } from "react";
import type { NewsMapData } from "./types";
import { fetchNewsData } from "./newsProcessor";

const DEFAULT_POLL_MINUTES = 15;

interface UseNewsMapReturn {
  data: NewsMapData | null;
  loading: boolean;
  error: string | null;
}

export function useNewsMap(pollMinutes = DEFAULT_POLL_MINUTES): UseNewsMapReturn {
  const [data, setData] = useState<NewsMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const result = await fetchNewsData();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, pollMinutes * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pollMinutes]);

  return { data, loading, error };
}
