"use client";
import { useEffect, useRef } from "react";

interface Props { prices: number[]; height?: number; opacity?: number; }

export default function Sparkline({ prices, height = 48, opacity = 0.35 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prices.length < 2) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);

    const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
    const isUp = prices[prices.length - 1] >= prices[0];
    const lineColor = isUp ? "#22c55e" : "#ef4444";
    const fillColor = isUp ? "rgba(34,197,94," : "rgba(239,68,68,";
    const pad = { top: 4, bottom: 4, left: 2, right: 2 };
    const drawW = W - pad.left - pad.right, drawH = H - pad.top - pad.bottom;
    const toX = (i: number) => pad.left + (i / (prices.length - 1)) * drawW;
    const toY = (p: number) => pad.top + (1 - (p - min) / range) * drawH;

    ctx.beginPath();
    prices.forEach((p, i) => { const x = toX(i), y = toY(p); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowBlur = 6; ctx.shadowColor = lineColor; ctx.stroke();

    ctx.shadowBlur = 0; ctx.lineTo(toX(prices.length - 1), H); ctx.lineTo(toX(0), H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, H);
    grad.addColorStop(0, fillColor + (opacity * 0.9) + ")"); grad.addColorStop(1, fillColor + "0)");
    ctx.fillStyle = grad; ctx.fill();

    const lx = toX(prices.length - 1), ly = toY(prices[prices.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2); ctx.fillStyle = lineColor;
    ctx.shadowBlur = 8; ctx.shadowColor = lineColor; ctx.fill();
  }, [prices, height, opacity]);

  return <canvas ref={canvasRef} className="sparkline" style={{ height: `${height}px`, display: "block", width: "100%", pointerEvents: "none" }} aria-hidden="true" />;
}
