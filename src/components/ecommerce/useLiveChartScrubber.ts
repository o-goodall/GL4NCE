import type { MouseEvent, RefObject, TouchEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PricePoint = [number, number];

export type PlotBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ScrubberOverlay = {
  x: number;
  y: number;
  price: number;
  timestamp: number;
  opacity: number;
};

export type UseLiveChartScrubberParams = {
  chartRef: RefObject<HTMLDivElement | null>;
  plotBoundsRef: RefObject<PlotBounds | null>;
  points: PricePoint[];
  yAxisMin: number;
  yAxisMax: number;
  livePrice: number | null;
  fallback: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    chartHeight: number;
  };
  releaseDurationMs?: number;
};

export type UseLiveChartScrubberResult = {
  isScrubbing: boolean;
  overlay: ScrubberOverlay | null;
  handlers: {
    onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
    onMouseMove: (e: MouseEvent<HTMLDivElement>) => void;
    onMouseLeave: () => void;
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => void;
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function useLiveChartScrubber({
  chartRef,
  plotBoundsRef,
  points,
  yAxisMin,
  yAxisMax,
  livePrice,
  fallback,
  releaseDurationMs = 260,
}: UseLiveChartScrubberParams): UseLiveChartScrubberResult {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [overlay, setOverlay] = useState<ScrubberOverlay | null>(null);

  const activeRef = useRef(false);
  const moveRafRef = useRef<number>(0);
  const releaseRafRef = useRef<number>(0);
  const pendingClientXRef = useRef<number | null>(null);
  const lastOverlayRef = useRef<ScrubberOverlay | null>(null);

  const currentPlot = useMemo<PlotBounds>(() => {
    const p = plotBoundsRef.current;
    const chartWidth = chartRef.current?.getBoundingClientRect().width ?? 0;
    if (p) return p;
    return {
      left: fallback.left,
      top: fallback.top,
      width: Math.max(1, chartWidth - fallback.left - fallback.right),
      height: Math.max(1, fallback.chartHeight - fallback.top - fallback.bottom),
    };
  }, [plotBoundsRef, chartRef, fallback]);

  const getPointAtClientX = useCallback(
    (clientX: number): ScrubberOverlay | null => {
      if (!points.length || !chartRef.current) return null;

      const wrapRect = chartRef.current.getBoundingClientRect();
      const plotLeftPx = wrapRect.left + currentPlot.left;
      const relative = clamp01((clientX - plotLeftPx) / currentPlot.width);
      const idx = Math.round(relative * (points.length - 1));
      const [timestamp, price] = points[idx];

      const snappedFrac = points.length > 1 ? idx / (points.length - 1) : 0;
      const x = currentPlot.left + snappedFrac * currentPlot.width;

      const range = yAxisMax - yAxisMin;
      const priceFrac = range > 0 ? clamp01((price - yAxisMin) / range) : 0.5;
      const y = currentPlot.top + (1 - priceFrac) * currentPlot.height;

      return { x, y, price, timestamp, opacity: 1 };
    },
    [points, chartRef, currentPlot, yAxisMax, yAxisMin],
  );

  const cancelAnimation = useCallback(() => {
    if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    if (releaseRafRef.current) cancelAnimationFrame(releaseRafRef.current);
    moveRafRef.current = 0;
    releaseRafRef.current = 0;
  }, []);

  const startScrub = useCallback(
    (clientX: number) => {
      cancelAnimation();
      activeRef.current = true;
      setIsScrubbing(true);
      const next = getPointAtClientX(clientX);
      if (next) {
        lastOverlayRef.current = next;
        setOverlay(next);
      }
    },
    [cancelAnimation, getPointAtClientX],
  );

  const moveScrub = useCallback(
    (clientX: number) => {
      if (!activeRef.current) return;
      pendingClientXRef.current = clientX;
      if (moveRafRef.current) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = 0;
        const nextX = pendingClientXRef.current;
        if (nextX === null) return;
        const next = getPointAtClientX(nextX);
        if (!next) return;
        lastOverlayRef.current = next;
        setOverlay(next);
      });
    },
    [getPointAtClientX],
  );

  const endScrub = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setIsScrubbing(false);

    const from = lastOverlayRef.current;
    if (!from || !points.length) {
      setOverlay(null);
      return;
    }

    const live = livePrice ?? points[points.length - 1][1];
    const range = yAxisMax - yAxisMin;
    const liveFrac = range > 0 ? clamp01((live - yAxisMin) / range) : 0.5;
    const toX = currentPlot.left + currentPlot.width;
    const toY = currentPlot.top + (1 - liveFrac) * currentPlot.height;
    const toTimestamp = points[points.length - 1][0];

    const startAt = performance.now();
    releaseRafRef.current = requestAnimationFrame(function tick(now: number) {
      const t = clamp01((now - startAt) / releaseDurationMs);
      const x = from.x + (toX - from.x) * t;
      const y = from.y + (toY - from.y) * t;
      const price = from.price + (live - from.price) * t;
      const timestamp = Math.round(from.timestamp + (toTimestamp - from.timestamp) * t);
      const next: ScrubberOverlay = { x, y, price, timestamp, opacity: 1 - t };
      setOverlay(next);
      lastOverlayRef.current = next;

      if (t < 1) {
        releaseRafRef.current = requestAnimationFrame(tick);
      } else {
        releaseRafRef.current = 0;
        setOverlay(null);
        lastOverlayRef.current = null;
      }
    });
  }, [points, livePrice, yAxisMax, yAxisMin, currentPlot, releaseDurationMs]);

  useEffect(() => {
    const onWindowMouseUp = () => endScrub();
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [endScrub]);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  return {
    isScrubbing,
    overlay,
    handlers: {
      onMouseDown: (e) => startScrub(e.clientX),
      onMouseMove: (e) => moveScrub(e.clientX),
      onMouseLeave: () => {
        if (activeRef.current) endScrub();
      },
      onTouchStart: (e) => {
        const t = e.touches[0];
        if (!t) return;
        startScrub(t.clientX);
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (!t) return;
        moveScrub(t.clientX);
      },
      onTouchEnd: () => endScrub(),
      onTouchCancel: () => endScrub(),
    },
  };
}
