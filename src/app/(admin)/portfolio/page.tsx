"use client";
import { useState, useMemo } from "react";
import { useGlance } from "@/context/GlanceContext";
import { n, pct, sc } from "@/lib/formatters";

const gc: React.CSSProperties = {
  background: "var(--glass-bg)", backdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--glass-bd)", borderRadius: 6, padding: 24,
  boxShadow: "0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06)",
  position: "relative", overflow: "hidden",
};

export default function PortfolioPage() {
  const g = useGlance();
  const [showHoldings, setShowHoldings] = useState(false);
  const s = g.settings.dca;
  const dcaDays = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));

  const inflAdj = useMemo(() => {
    if (g.gfNetWorth === null || g.cpiAnnual === null) return null;
    const y = dcaDays / 365.25;
    return g.gfNetWorth / Math.pow(1 + g.cpiAnnual / 100, y);
  }, [g.gfNetWorth, g.cpiAnnual, dcaDays]);

  const cpiLoss = useMemo(() => {
    if (g.cpiAnnual === null) return 0;
    const y = Math.max(0.1, dcaDays / 365.25);
    return (1 - 1 / Math.pow(1 + g.cpiAnnual / 100, y)) * 100;
  }, [g.cpiAnnual, dcaDays]);

  const portCAGR = useMemo(() => {
    if (g.gfNetGainPct === null) return null;
    const y = Math.max(0.1, dcaDays / 365.25);
    return (Math.pow(1 + g.gfNetGainPct / 100, 1 / y) - 1) * 100;
  }, [g.gfNetGainPct, dcaDays]);

  const assets = [
    { ticker: "BTC", name: "Bitcoin", icon: "₿", pct: null, color: "#f7931a", sub: g.btcPrice ? "$" + n(g.btcPrice) : "—" },
    { ticker: "XAU", name: "Gold", icon: "◈", pct: g.goldYtdPct, color: "#c9a84c", sub: g.goldPriceUsd ? "$" + n(g.goldPriceUsd, 0) + "/oz" : "—" },
    { ticker: "SPX", name: "S&P 500", icon: "↗", pct: g.sp500YtdPct, color: "#888", sub: g.sp500Price ? n(g.sp500Price, 0) : "—" },
    { ticker: "CPI", name: "Inflation", icon: "↓", pct: g.cpiAnnual, color: "#ef4444", sub: "Annual rate" },
  ];

  return (
    <>
      <div className="flex items-baseline gap-4 mb-7">
        <h2 style={{ fontFamily: "'Orbitron',monospace", fontSize: "1.1rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".12em", background: "linear-gradient(45deg,#f7931a,#00c8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingBottom: 10, position: "relative" }}>
          Portfolio
          <span style={{ position: "absolute", bottom: 0, left: 0, width: 40, height: 2, background: "linear-gradient(90deg,#f7931a,#00c8ff)", boxShadow: "0 0 10px rgba(247,147,26,.6)" }} />
        </h2>
        <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>Assets &amp; Performance</span>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1.6fr" }}>
        {/* ASSET COMPARISON */}
        <div style={gc}>
          <div className="flex justify-between items-start mb-4">
            <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>Asset Comparison</p>
            <p style={{ fontSize: ".64rem", color: "var(--t2)" }}>1-Year Performance</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-1">
            {assets.map(a => (
              <div key={a.ticker} className="p-4 rounded-md relative overflow-hidden transition-transform duration-300 hover:-translate-y-1"
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ fontSize: "1.2rem", color: a.color }}>{a.icon}</span>
                  <div>
                    <p style={{ fontSize: ".8rem", fontWeight: 700, color: a.color }}>{a.ticker}</p>
                    <p style={{ fontSize: ".58rem", color: "var(--t2)", marginTop: 1 }}>{a.name}</p>
                  </div>
                </div>
                <p style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1, marginBottom: 3, color: a.pct !== null ? (a.pct >= 0 ? "var(--up)" : "var(--dn)") : a.color }}>
                  {a.pct !== null ? (a.pct >= 0 ? "+" : "") + a.pct.toFixed(1) + "%" : "live"}
                </p>
                <p style={{ fontSize: ".6rem", color: "var(--t2)" }}>{a.sub}</p>
                <div style={{ height: 2, background: "rgba(255,255,255,.06)", borderRadius: 1, overflow: "hidden", marginTop: 8 }}>
                  <div style={{
                    height: "100%", borderRadius: 1, transition: "width .7s",
                    width: a.pct !== null ? `${Math.min(100, Math.max(2, (a.pct / 150) * 100 + 50))}%` : "70%",
                    background: a.pct !== null ? (a.pct >= 0 ? "var(--up)" : "var(--dn)") : a.color,
                    opacity: a.pct !== null ? 0.55 : undefined,
                    animation: a.pct === null ? "apPulse 3s ease-in-out infinite" : undefined,
                  }} />
                </div>
              </div>
            ))}
          </div>
          {g.cpiAnnual !== null && (
            <p style={{ fontSize: ".64rem", color: "var(--t2)", marginTop: 14, lineHeight: 1.6 }}>
              Purchasing power erosion since DCA start: <span style={{ color: "var(--dn)" }}>−{cpiLoss.toFixed(1)}%</span>
            </p>
          )}
        </div>

        {/* GHOSTFOLIO */}
        <div style={gc}>
          {!g.settings.ghostfolio?.token ? (
            <>
              <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>Connect Ghostfolio</p>
              <p style={{ fontSize: ".64rem", color: "var(--t2)", lineHeight: 1.7, marginBottom: 8 }}>Add your Ghostfolio security token in Settings to see full portfolio performance and holdings.</p>
              <p style={{ fontSize: ".64rem", color: "var(--t2)", lineHeight: 1.6 }}>Your token is stored locally in your browser only.</p>
            </>
          ) : (
            <>
              <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-2.5">
                  <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>Portfolio</p>
                  <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>via Ghostfolio</span>
                </div>
                <div className="flex items-center gap-2.5">
                  {g.gfLoading && <span className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--orange)", display: "inline-block" }} />}
                  {g.gfUpdated && !g.gfLoading && <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>{g.gfUpdated}</span>}
                  <button onClick={g.refreshGhostfolio} className="btn-ghost">↻ Refresh</button>
                </div>
              </div>

              {g.gfError ? (
                <p style={{ fontSize: ".72rem", color: "var(--dn)", padding: "10px 14px", border: "1px solid rgba(239,68,68,.2)", borderRadius: 4, background: "rgba(239,68,68,.05)" }}>{g.gfError} — check token in Settings.</p>
              ) : (
                <>
                  <div className="flex items-end gap-5 flex-wrap mb-4">
                    <div>
                      <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>Net Worth</p>
                      <p style={{ fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1, color: "var(--t1)" }}>{g.gfNetWorth !== null ? "$" + n(g.gfNetWorth, 0) : "—"}</p>
                      <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)", marginTop: 4 }}>{g.settings.ghostfolio.currency || "AUD"}</p>
                    </div>
                    {inflAdj !== null && (
                      <div style={{ opacity: 0.4 }}>
                        <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>Real Value</p>
                        <p style={{ fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1, color: "var(--t1)" }}>${n(inflAdj, 0)}</p>
                        <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)", marginTop: 4 }}>CPI-adjusted</p>
                      </div>
                    )}
                    <div className="flex items-end gap-4 flex-wrap flex-1" style={{ borderLeft: "1px solid rgba(255,255,255,.06)", paddingLeft: 20, minWidth: 0 }}>
                      {[["Today", g.gfTodayChangePct], ["YTD", g.gfNetGainYtdPct], ["All-time", g.gfNetGainPct], ["Invested", g.gfTotalInvested]].map(([label, val]) => (
                        <div key={label as string} className="flex flex-col gap-1.5">
                          <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>{label as string}</p>
                          <p style={{ fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-.025em", lineHeight: 1, color: label === "Invested" ? "var(--t1)" : sc(val as number | null) }}>
                            {label === "Invested" ? (val !== null ? "$" + n(val as number, 0) : "—") : pct(val as number | null)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Benchmark bar */}
                  {(portCAGR !== null || g.cpiAnnual !== null || g.goldYtdPct !== null) && (
                    <div className="flex flex-wrap rounded-md overflow-hidden mb-4" style={{ border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}>
                      {portCAGR !== null && (
                        <div className="flex-1 p-3.5 flex flex-col gap-1" style={{ borderRight: "1px solid rgba(255,255,255,.06)", minWidth: 80 }}>
                          <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--orange)" }}>Portfolio CAGR</p>
                          <p style={{ fontSize: "1.15rem", fontWeight: 700, color: portCAGR >= 0 ? "var(--up)" : "var(--dn)" }}>{portCAGR >= 0 ? "+" : ""}{portCAGR.toFixed(1)}<span style={{ fontSize: ".55em", opacity: 0.5 }}>%/yr</span></p>
                          {g.cpiAnnual !== null && <p style={{ fontSize: ".6rem", color: portCAGR > g.cpiAnnual ? "var(--up)" : "var(--dn)" }}>{portCAGR > g.cpiAnnual ? "▲" : "▼"} {Math.abs(portCAGR - g.cpiAnnual).toFixed(1)}% vs CPI</p>}
                        </div>
                      )}
                      {g.cpiAnnual !== null && (
                        <div className="flex-1 p-3.5 flex flex-col gap-1" style={{ borderRight: "1px solid rgba(255,255,255,.06)", minWidth: 80 }}>
                          <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--dn)" }}>Inflation</p>
                          <p style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--dn)" }}>+{g.cpiAnnual.toFixed(1)}<span style={{ fontSize: ".55em", opacity: 0.5 }}>%/yr</span></p>
                        </div>
                      )}
                      {g.goldYtdPct !== null && (
                        <div className="flex-1 p-3.5 flex flex-col gap-1" style={{ borderRight: "1px solid rgba(255,255,255,.06)", minWidth: 80 }}>
                          <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "#c9a84c" }}>Gold 1Y</p>
                          <p style={{ fontSize: "1.15rem", fontWeight: 700, color: g.goldYtdPct >= 0 ? "#c9a84c" : "var(--dn)" }}>{g.goldYtdPct >= 0 ? "+" : ""}{g.goldYtdPct.toFixed(1)}<span style={{ fontSize: ".55em", opacity: 0.5 }}>%</span></p>
                        </div>
                      )}
                      {g.sp500YtdPct !== null && (
                        <div className="flex-1 p-3.5 flex flex-col gap-1" style={{ minWidth: 80 }}>
                          <p style={{ fontSize: ".58rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--t2)" }}>S&amp;P 500</p>
                          <p style={{ fontSize: "1.15rem", fontWeight: 700, color: g.sp500YtdPct >= 0 ? "var(--t1)" : "var(--dn)" }}>{g.sp500YtdPct >= 0 ? "+" : ""}{g.sp500YtdPct.toFixed(1)}<span style={{ fontSize: ".55em", opacity: 0.5 }}>%</span></p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Holdings */}
                  {g.gfHoldings.length > 0 && (
                    <div style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 16 }}>
                      <button className="btn-secondary" style={{ fontSize: ".62rem", padding: "7px 16px" }} onClick={() => setShowHoldings(!showHoldings)}>
                        {showHoldings ? "▲" : "▼"} Holdings ({g.gfHoldings.length})
                      </button>
                      {showHoldings && (
                        <div className="grid gap-2 mt-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))" }}>
                          {g.gfHoldings.map(h => {
                            const hp = h.netPerformancePercentWithCurrencyEffect;
                            return (
                              <div key={h.symbol} className="p-3.5 rounded-md transition-transform duration-300 hover:-translate-y-1"
                                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                                <div className="flex justify-between items-baseline mb-1">
                                  <span style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--t1)" }}>{h.symbol}</span>
                                  <span style={{ fontSize: ".68rem", fontWeight: 600, color: hp >= 0 ? "var(--up)" : "var(--dn)" }}>{hp >= 0 ? "+" : ""}{hp.toFixed(1)}%</span>
                                </div>
                                {h.name !== h.symbol && <p style={{ fontSize: ".6rem", color: "var(--t2)", marginBottom: 0 }}>{h.name.slice(0, 22)}</p>}
                                <div style={{ height: 2, background: "rgba(255,255,255,.06)", borderRadius: 1, overflow: "hidden", margin: "8px 0 6px" }}>
                                  <div style={{ height: "100%", width: `${Math.min(100, h.allocationInPercentage)}%`, background: "linear-gradient(90deg,rgba(247,147,26,.55),var(--orange))", borderRadius: 1 }} />
                                </div>
                                <div className="flex justify-between" style={{ fontSize: ".62rem", color: "var(--t2)" }}>
                                  <span>{h.allocationInPercentage.toFixed(1)}%</span>
                                  <span>${n(h.valueInBaseCurrency, 0)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width:1000px) { .grid[style*="1.6fr"] { grid-template-columns: 1fr !important; } }
        @media (max-width:400px) { .grid-cols-2 { grid-template-columns: 1fr !important; } }
        @media (max-width:600px) { div[style*="2.4rem"] { font-size: 1.8rem !important; } }
      `}</style>
    </>
  );
}
