"use client";
import { useGlance } from "@/context/GlanceContext";
import { fmtVol, fmtDate, pc, ago } from "@/lib/formatters";

const gc: React.CSSProperties = {
  background: "var(--glass-bg)", backdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--glass-bd)", borderRadius: 6, padding: 24,
  boxShadow: "0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06)",
  position: "relative", overflow: "hidden",
};

export default function IntelPage() {
  const g = useGlance();

  return (
    <>
      <div className="flex items-baseline gap-4 mb-7">
        <h2 style={{ fontFamily: "'Orbitron',monospace", fontSize: "1.1rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".12em", background: "linear-gradient(45deg,#f7931a,#00c8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingBottom: 10, position: "relative" }}>
          Intel
          <span style={{ position: "absolute", bottom: 0, left: 0, width: 40, height: 2, background: "linear-gradient(90deg,#f7931a,#00c8ff)", boxShadow: "0 0 10px rgba(247,147,26,.6)" }} />
        </h2>
        <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>Markets &amp; News</span>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* PREDICTION MARKETS */}
        <div style={gc}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>Prediction Markets</p>
              <p style={{ fontSize: ".64rem", color: "var(--t2)", marginTop: 2 }}>What the crowd expects</p>
            </div>
            <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="btn-ghost">Polymarket ↗</a>
          </div>

          {g.markets.length === 0 ? (
            <p style={{ fontSize: ".64rem", color: "var(--t2)" }}>Fetching live markets…</p>
          ) : (
            g.markets.slice(0, 8).map(m => (
              <div key={m.id} style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                <div className="flex justify-between items-start gap-3.5 mb-2">
                  <a href={m.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: ".78rem", color: "var(--t1)", opacity: 0.7, lineHeight: 1.5, flex: 1, textDecoration: "none", transition: "opacity .2s" }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "0.7")}>
                    {m.question}
                  </a>
                  <span style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-.03em", color: pc(m.probability), flexShrink: 0 }}>
                    {m.probability}<span style={{ fontSize: ".7rem", fontWeight: 600, opacity: 0.5 }}>%</span>
                  </span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,.04)", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${m.probability}%`, background: pc(m.probability), borderRadius: 2, transition: "width .7s", opacity: 0.6 }} />
                </div>
                <div className="flex justify-between items-center flex-wrap gap-1.5">
                  <div className="flex items-center gap-2">
                    {m.pinned ? (
                      <span style={{ fontSize: ".56rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".07em", padding: "3px 8px", borderRadius: 3, background: "rgba(247,147,26,.09)", border: "1px solid rgba(247,147,26,.24)", color: "var(--orange)" }}>★ Watching</span>
                    ) : (
                      <span style={{ fontSize: ".56rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".07em", padding: "3px 8px", borderRadius: 3, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", color: "var(--t2)" }}>{m.tag}</span>
                    )}
                    <span style={{ fontSize: ".62rem", fontWeight: 500, color: pc(m.probability) }}>{m.topOutcome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.endDate && <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>{fmtDate(m.endDate)}</span>}
                    <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>{fmtVol(m.volume)} volume</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* NEWS FEED */}
        <div style={gc}>
          <div className="flex justify-between items-start mb-4">
            <p style={{ fontFamily: "'Orbitron',monospace", fontSize: ".72rem", fontWeight: 700, color: "var(--t1)", textTransform: "uppercase", letterSpacing: ".08em" }}>News Feed</p>
            <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>{g.newsItems.length} articles</span>
          </div>

          {g.newsItems.length === 0 ? (
            <p style={{ fontSize: ".64rem", color: "var(--t2)" }}>Fetching RSS feeds…</p>
          ) : (
            g.newsItems.map((item, i) => (
              <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                <a href={item.link} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontSize: ".78rem", color: "var(--t1)", opacity: 0.65, textDecoration: "none", lineHeight: 1.52, marginBottom: 5, transition: "opacity .2s" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.65")}>
                  {item.title}
                </a>
                {item.description && <p style={{ fontSize: ".66rem", color: "var(--t2)", lineHeight: 1.5, marginBottom: 6, opacity: 0.7 }}>{item.description}</p>}
                <div className="flex gap-2.5 items-center">
                  <span style={{ fontSize: ".6rem", color: "var(--orange)", fontWeight: 600 }}>{item.source}</span>
                  <span style={{ fontSize: ".64rem", color: "var(--t2)" }}>{ago(item.pubDate)} ago</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`@media (max-width:900px) { .grid[style*="1fr 1fr"] { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
