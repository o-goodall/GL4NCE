"use client";
import { useState, useMemo } from "react";
import { useGlance } from "@/context/GlanceContext";
import { n, fmtBytes, fmtSats, blockAge } from "@/lib/formatters";
import Sparkline from "@/components/common/Sparkline";

/* ── glass card helper ─────────────────────────────────────── */
const gc = "relative overflow-hidden rounded-md p-6 transition-all duration-300 max-md:p-4";
const gcStyle: React.CSSProperties = {
  background: "var(--glass-bg)", backdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--glass-bd)", boxShadow: "0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06)",
};

export default function DashboardPage() {
  const g = useGlance();
  const [priceCurrency, setPriceCurrency] = useState<"usd" | "aud">("usd");

  const audHistory = useMemo(() =>
    g.audUsd && g.priceHistory.length ? g.priceHistory.map(p => p * g.audUsd!) : [],
    [g.audUsd, g.priceHistory]
  );

  const priceZone = g.btcPrice <= 55000 ? "LOW" : g.btcPrice <= 75000 ? "LOW–MID" : g.btcPrice <= 95000 ? "MID" : g.btcPrice <= 110000 ? "MID–HIGH" : "HIGH";
  const zoneColor = g.btcPrice <= 55000 ? "var(--up)" : g.btcPrice <= 75000 ? "#4ade80" : g.btcPrice <= 95000 ? "var(--orange)" : g.btcPrice <= 110000 ? "#f97316" : "var(--dn)";
  const dcaZoneGif = g.btcPrice <= 0 ? "" : g.btcPrice <= 78000 ? "/dca-red.gif" : g.btcPrice <= 102000 ? "/dca-amber.gif" : "/dca-green.gif";

  const s = g.settings.dca;
  const dcaDays = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));
  const invested = dcaDays * s.dailyAmount;
  const currentVal = s.btcHeld * g.btcPrice;
  const perf = invested > 0 ? ((currentVal - invested) / invested) * 100 : 0;
  const goalPct = s.goalBtc > 0 ? Math.min(100, (s.btcHeld / s.goalBtc) * 100) : 0;
  const satsHeld = Math.round(s.btcHeld * 1e8);
  const satsLeft = Math.max(0, Math.round((s.goalBtc - s.btcHeld) * 1e8));

  return (
    <>
      {/* SECTION HEADER */}
      <div className="flex items-baseline gap-4 mb-7">
        <h2 style={{ fontFamily: "'Orbitron',monospace", fontSize: "1.1rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".12em", background: "linear-gradient(45deg,#f7931a,#00c8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingBottom: 10, position: "relative" }}>
          Signal Analysis
          <span style={{ position: "absolute", bottom: 0, left: 0, width: 40, height: 2, background: "linear-gradient(90deg,#f7931a,#00c8ff)", boxShadow: "0 0 10px rgba(247,147,26,.6)" }} />
        </h2>
        <span style={{ fontSize: ".65rem", color: "var(--t2)", display: "flex", alignItems: "center", gap: 5 }}>
          <span className="blink" style={{ color: "var(--orange)" }}>●</span> Live
        </span>
      </div>

      {/* METRIC STRIP */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "1.5fr 1fr 1fr 1fr" }}>
        {/* BTC Price tile with sparkline */}
        <div className={gc} style={{ ...gcStyle, paddingBottom: 0, position: "relative", overflow: "hidden", gridColumn: undefined }}>
          {priceCurrency === "usd" && g.priceHistory.length >= 2 && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 52, opacity: 0.7, pointerEvents: "none" }}>
              <Sparkline prices={g.priceHistory} height={52} opacity={0.28} />
            </div>
          )}
          {priceCurrency === "aud" && audHistory.length >= 2 && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 52, opacity: 0.7, pointerEvents: "none" }}>
              <Sparkline prices={audHistory} height={52} opacity={0.28} />
            </div>
          )}
          <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
            <span style={{ display: "block", fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-.025em", marginBottom: 4, lineHeight: 1.1, color: g.priceColor, transition: "color .5s", marginTop: 8 }}>
              {priceCurrency === "usd" ? (g.btcPrice > 0 ? "$" + n(g.btcPrice) : "—") : (g.btcAud ? "A$" + n(g.btcAud, 0) : "—")}
            </span>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, paddingBottom: 56 }}>
              <span style={{ fontSize: ".58rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".1em" }}>BTC Price</span>
              <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,.06)", borderRadius: 3, padding: 1 }}>
                {(["usd", "aud"] as const).map(c => (
                  <button key={c} onClick={() => setPriceCurrency(c)}
                    style={{ padding: "3px 10px", fontSize: ".52rem", fontWeight: 700, fontFamily: "'Orbitron',monospace", letterSpacing: ".08em", background: priceCurrency === c ? "var(--orange)" : "none", border: "none", color: priceCurrency === c ? "#fff" : "var(--t2)", cursor: "pointer", borderRadius: 2, textTransform: "uppercase" }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={gc} style={{ ...gcStyle, textAlign: "center" }}>
          <span style={{ display: "block", fontSize: "1.4rem", fontWeight: 700, color: "var(--orange)", marginBottom: 6 }}>{g.satsPerAud ? g.satsPerAud.toLocaleString() : "—"}</span>
          <span style={{ fontSize: ".58rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".1em" }}>Sats per A$1</span>
        </div>
        <div className={gc} style={{ ...gcStyle, textAlign: "center" }}>
          <span style={{ display: "block", fontSize: "1.4rem", fontWeight: 700, color: "var(--t1)", marginBottom: 6 }}>{g.halvingDays > 0 ? g.halvingDays.toLocaleString() : "—"}</span>
          <span style={{ fontSize: ".58rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".1em" }}>Days to Halving</span>
        </div>
        <div className={gc} style={{ ...gcStyle, textAlign: "center" }}>
          <span style={{ display: "block", fontSize: "1.4rem", fontWeight: 700, color: zoneColor, marginBottom: 6 }}>{priceZone}</span>
          <span style={{ fontSize: ".58rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".1em" }}>Price Zone</span>
        </div>
      </div>

      {/* SIGNAL GRID */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1.1fr 1fr 1fr" }}>

        {/* DCA SIGNAL CARD */}
        <div className={gc} style={{ ...gcStyle, background: "linear-gradient(180deg,rgba(247,147,26,.08) 0%,var(--glass-bg) 80px)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, borderRadius: "6px 6px 0 0", zIndex: 3, background: `linear-gradient(90deg,${g.accentColor}33,${g.accentColor},${g.accentColor}33)` }} />
          {dcaZoneGif && (
            <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
              <img src={dcaZoneGif} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%", opacity: 0.18, filter: "blur(4px) saturate(120%)", animation: "zoneFadeIn .8s ease-out" }} />
            </div>
          )}
          <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(180deg, rgba(14,14,14,.72) 0%, rgba(14,14,14,.55) 40%, rgba(14,14,14,.7) 100%)", backdropFilter: "blur(2px)" }} />

          <div style={{ position: "relative", zIndex: 2 }}>
            <div className="flex justify-between items-start mb-4 gap-3">
              <div>
                <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--orange)" }}>DCA Signal</p>
                <p style={{ fontSize: ".64rem", color: "var(--t2)", marginTop: 3 }}>How much to buy this fortnight</p>
              </div>
              <span style={{ fontSize: ".58rem", color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{g.dcaUpdated || "—"}</span>
            </div>

            {/* Hero amount */}
            <div style={{ textAlign: "center", padding: "18px 0 16px" }}>
              {!g.dca ? (
                <span style={{ display: "block", fontSize: "clamp(3rem,7vw,5rem)", fontWeight: 800, color: "var(--t3)", opacity: 0.3 }}>—</span>
              ) : g.dca.finalAud === 0 ? (
                <>
                  <span style={{ display: "block", fontSize: "clamp(3rem,7vw,5rem)", fontWeight: 800, color: "var(--dn)", textShadow: "0 0 60px rgba(239,68,68,.3)" }}>PASS</span>
                  <p style={{ fontSize: ".62rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".12em", marginTop: 8 }}>Price too high — skip this fortnight</p>
                </>
              ) : (
                <>
                  <span style={{ display: "block", fontSize: "clamp(3rem,7vw,5rem)", fontWeight: 800, lineHeight: 1, color: g.accentColor, textShadow: `0 0 70px ${g.accentColor}30`, transition: "color .5s" }}>
                    ${g.dca.finalAud.toLocaleString()}
                  </span>
                  <p style={{ fontSize: ".62rem", color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".12em", marginTop: 8 }}>AUD · fortnightly buy</p>
                </>
              )}
            </div>

            {/* Price zone bar */}
            {g.btcPrice > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="flex justify-between items-center mb-1.5">
                  <span style={{ fontSize: ".58rem", fontWeight: 600, color: "var(--up)" }}>Low Zone</span>
                  <span style={{ fontSize: ".58rem", fontWeight: 600, color: "var(--orange)" }}>Mid Zone</span>
                  <span style={{ fontSize: ".58rem", fontWeight: 600, color: "var(--dn)" }}>High Zone</span>
                </div>
                <div style={{ height: 8, background: "rgba(255,255,255,.04)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                  <div className="flex h-full">
                    <div style={{ flex: 1, background: "linear-gradient(90deg,rgba(34,197,94,.4),rgba(34,197,94,.15))" }} />
                    <div style={{ flex: 1, background: "linear-gradient(90deg,rgba(247,147,26,.15),rgba(247,147,26,.25),rgba(247,147,26,.15))" }} />
                    <div style={{ flex: 1, background: "linear-gradient(90deg,rgba(239,68,68,.15),rgba(239,68,68,.4))" }} />
                  </div>
                  <div style={{
                    position: "absolute", top: "50%", transform: "translate(-50%,-50%)",
                    width: 14, height: 14, borderRadius: "50%", background: "var(--t1)", border: "2px solid var(--orange)",
                    boxShadow: "0 0 10px rgba(247,147,26,.5)", transition: "left .8s cubic-bezier(.4,0,.2,1)",
                    left: `${Math.max(2, Math.min(98, ((g.btcPrice - 55000) / 70000) * 100))}%`,
                  }} />
                </div>
                <div className="flex justify-between mt-1" style={{ fontSize: ".54rem", color: "var(--t3)", fontWeight: 500 }}>
                  <span>$55K</span><span>$90K</span><span>$125K</span>
                </div>
              </div>
            )}

            {/* Signal conditions */}
            {g.dca && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.05)" }}>
                {g.dca.signals.map(sig => (
                  <div key={sig.name} className="flex items-center gap-3" style={{ opacity: sig.active ? 1 : 0.25, transition: "opacity .2s" }}>
                    <div style={{ position: "relative", width: 14, height: 14, flexShrink: 0 }}>
                      <div style={{
                        width: 9, height: 9, borderRadius: "50%",
                        background: sig.active ? "var(--orange)" : "rgba(255,255,255,.1)",
                        border: `1px solid ${sig.active ? "var(--orange)" : "rgba(255,255,255,.15)"}`,
                        boxShadow: sig.active ? "0 0 10px rgba(247,147,26,.6)" : "none",
                        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                      }} />
                      {sig.active && <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(247,147,26,.14)", animation: "rp 2s ease-out infinite" }} />}
                    </div>
                    <span style={{ fontSize: ".72rem", color: "var(--t1)", opacity: 0.85, flex: 1 }}>{sig.name}</span>
                    {sig.active && <span style={{ fontSize: ".6rem", color: "var(--orange)", fontWeight: 600, background: "rgba(247,147,26,.1)", border: "1px solid rgba(247,147,26,.22)", padding: "2px 8px", borderRadius: 3 }}>+{sig.boost}%</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* BITCOIN NETWORK */}
        <div className={gc} style={gcStyle}>
          <div className="flex justify-between items-start mb-4 gap-3">
            <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>Bitcoin Network</p>
            <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" className="btn-ghost">mempool ↗</a>
          </div>

          {g.latestBlock && (
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,.05)" }}>
              <div className="flex justify-between items-center mb-2.5">
                <span style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--orange)" }}>Latest Block</span>
                <span style={{ fontSize: ".58rem", color: "var(--t3)" }}>{blockAge(g.latestBlock.timestamp)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  ["Block", n(g.latestBlock.height)],
                  ["Mined by", g.latestBlock.miner],
                  ["Transactions", n(g.latestBlock.txCount)],
                  ["Size", fmtBytes(g.latestBlock.size)],
                  ...(g.latestBlock.totalFees ? [["Total Fees", fmtSats(g.latestBlock.totalFees)]] : []),
                  ...(g.latestBlock.medianFee ? [["Median Fee", `${g.latestBlock.medianFee} sat/vB`]] : []),
                ].map(([label, val]) => (
                  <div key={label as string} className="flex flex-col gap-1">
                    <span style={{ fontSize: ".56rem", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--t2)", fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: ".82rem", fontWeight: 600, color: label === "Mined by" ? "var(--orange)" : "var(--t1)" }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {g.mempoolStats && (
            <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.05)" }}>
              <div className="flex justify-between items-center mb-2.5">
                <span style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>Mempool</span>
                <span style={{ fontSize: ".58rem", color: "var(--t3)" }}>{n(g.mempoolStats.count)} unconfirmed</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[["Pending TXs", n(g.mempoolStats.count)], ["Size", fmtBytes(g.mempoolStats.vsize)], ["Total Fees", fmtSats(g.mempoolStats.totalFee)]].map(([l, v]) => (
                  <div key={l} className="flex flex-col gap-1">
                    <span style={{ fontSize: ".56rem", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--t2)", fontWeight: 500 }}>{l}</span>
                    <span style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--t1)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fees */}
          <div className="grid grid-cols-3 gap-3.5 mt-3.5">
            {[["Fee · Low", g.btcFees.low, "var(--up)"], ["Fee · Med", g.btcFees.medium, "var(--t1)"], ["Fee · High", g.btcFees.high, "var(--dn)"]].map(([label, val, color]) => (
              <div key={label as string} className="flex flex-col gap-1.5">
                <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>{label as string}</p>
                <p style={{ fontSize: "1.4rem", fontWeight: 700, color: color as string, lineHeight: 1 }}>
                  {(val as number) || "—"}<span style={{ fontSize: ".48em", color: "var(--t2)", fontWeight: 400, marginLeft: 2 }}>sat/vB</span>
                </p>
              </div>
            ))}
          </div>

          {/* Halving */}
          {g.halvingBlocksLeft > 0 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", marginTop: 18, paddingTop: 16 }}>
              <div className="flex justify-between items-start mb-2.5 gap-3">
                <div>
                  <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>Next Halving</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--orange)", lineHeight: 1 }}>
                    {g.halvingDays.toLocaleString()}<span style={{ fontSize: ".55em", color: "rgba(247,147,26,.7)", fontWeight: 400 }}> days</span>
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>{g.halvingProgress.toFixed(1)}% complete</p>
                  <p style={{ fontSize: ".64rem", color: "var(--t2)", marginTop: 2 }}>{g.halvingBlocksLeft.toLocaleString()} blocks</p>
                </div>
              </div>
              <div style={{ height: 2, background: "rgba(255,255,255,.06)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${g.halvingProgress}%`, background: "linear-gradient(90deg,rgba(247,147,26,.5),var(--orange))", borderRadius: 1, transition: "width .7s" }} />
              </div>
            </div>
          )}
        </div>

        {/* MY STACK */}
        <div className={gc} style={gcStyle}>
          <div className="flex justify-between items-start mb-4 gap-3">
            <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>My Stack</p>
            <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>${s.dailyAmount}/day · {dcaDays}d</span>
          </div>
          <div className="grid grid-cols-3 gap-3.5 mb-4">
            {[["Invested", "$" + n(invested), "var(--t1)"], ["Value", g.btcPrice > 0 ? "$" + n(currentVal) : "—", perf >= 0 ? "var(--up)" : "var(--dn)"], ["Return", g.btcPrice > 0 ? (perf >= 0 ? "+" : "") + perf.toFixed(1) + "%" : "—", perf >= 0 ? "var(--up)" : "var(--dn)"]].map(([label, val, color]) => (
              <div key={label as string} className="flex flex-col gap-1.5">
                <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>{label as string}</p>
                <p style={{ fontSize: "1.4rem", fontWeight: 700, color: color as string, lineHeight: 1 }}>{val as string}</p>
              </div>
            ))}
          </div>

          <div className="flex items-baseline flex-wrap gap-1 p-3 rounded mb-4" style={{ background: "rgba(247,147,26,.05)", border: "1px solid rgba(247,147,26,.12)" }}>
            <span style={{ color: "var(--orange)", fontWeight: 700, fontSize: ".92rem" }}>{s.btcHeld.toFixed(8)}</span>
            <span style={{ color: "var(--t2)", margin: "0 6px" }}>BTC</span>
            <span style={{ color: "var(--t3)", fontSize: ".72rem" }}>{n(satsHeld)} sats</span>
          </div>

          <div>
            <div className="flex justify-between mb-1.5">
              <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>Goal · {s.goalBtc} BTC</p>
              <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--orange)" }}>{goalPct.toFixed(1)}%</p>
            </div>
            <div style={{ height: 2, background: "rgba(255,255,255,.06)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${goalPct}%`, background: "linear-gradient(90deg,rgba(247,147,26,.6),var(--orange))", borderRadius: 1, transition: "width .7s" }} />
            </div>
            <p style={{ fontSize: ".64rem", color: "var(--t2)", textAlign: "right", marginTop: 4 }}>{n(satsLeft)} sats remaining</p>
          </div>
        </div>
      </div>

      {/* Responsive overrides via style tag */}
      <style>{`
        @media (max-width:800px) { .grid[style*="1.5fr"] { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width:1100px) { .grid[style*="1.1fr"] { grid-template-columns: 1fr 1fr !important; } }
        @media (max-width:700px) { .grid[style*="1.1fr"] { grid-template-columns: 1fr !important; } }
      `}</style>
    </>
  );
}
