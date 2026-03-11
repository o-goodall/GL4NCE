"use client";
import { useState } from "react";
import { useGlance } from "@/context/GlanceContext";
import type { Settings, RssFeed } from "@/lib/settings";

const gc: React.CSSProperties = {
  background: "var(--glass-bg)", backdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--glass-bd)", borderRadius: 6, padding: 24,
  boxShadow: "0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06)",
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,94,0,.22)",
  borderRadius: 3, padding: "10px 12px", color: "var(--t1)",
  fontFamily: "'Inter',sans-serif", fontSize: ".82rem", transition: "border-color .2s, box-shadow .2s",
};

interface DcaField {
  label: string;
  type: string;
  value: string | number;
  onChange: (v: string) => void;
  step?: string;
}

export default function SettingsPage() {
  const { settings, setSettings, persistSettings } = useGlance();
  const [saved, setSaved] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newSourceName, setNewSourceName] = useState("");

  const handleSave = () => {
    persistSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateDca = (key: string, value: string | number) => {
    const next: Settings = { ...settings, dca: { ...settings.dca, [key]: value } };
    setSettings(next);
  };

  const addKeyword = () => {
    if (newKeyword.trim()) {
      const next: Settings = { ...settings, polymarket: { ...settings.polymarket, keywords: [...settings.polymarket.keywords, newKeyword.trim()] } };
      setSettings(next);
      setNewKeyword("");
    }
  };

  const removeKeyword = (i: number) => {
    const next: Settings = { ...settings, polymarket: { ...settings.polymarket, keywords: settings.polymarket.keywords.filter((_kw: string, j: number) => j !== i) } };
    setSettings(next);
  };

  const toggleDefaultFeed = (i: number) => {
    const feeds = [...settings.news.defaultFeeds];
    feeds[i] = { ...feeds[i], enabled: !feeds[i].enabled };
    const next: Settings = { ...settings, news: { ...settings.news, defaultFeeds: feeds } };
    setSettings(next);
  };

  const toggleCustomFeed = (i: number) => {
    const feeds = [...settings.news.customFeeds];
    feeds[i] = { ...feeds[i], enabled: !feeds[i].enabled };
    const next: Settings = { ...settings, news: { ...settings.news, customFeeds: feeds } };
    setSettings(next);
  };

  const addSource = () => {
    if (newSource.trim()) {
      let name = newSourceName.trim();
      if (!name) {
        try { name = new URL(newSource.trim()).hostname.replace("www.", "").replace("feeds.", ""); } catch { name = "Custom"; }
      }
      const next: Settings = { ...settings, news: { ...settings.news, customFeeds: [...settings.news.customFeeds, { url: newSource.trim(), name, enabled: true }] } };
      setSettings(next);
      setNewSource(""); setNewSourceName("");
    }
  };

  const removeSource = (i: number) => {
    const next: Settings = { ...settings, news: { ...settings.news, customFeeds: settings.news.customFeeds.filter((_f: RssFeed, j: number) => j !== i) } };
    setSettings(next);
  };

  const dcaFields: DcaField[] = [
    { label: "Start date", type: "date", value: settings.dca.startDate, onChange: (v: string) => updateDca("startDate", v) },
    { label: "Daily AUD", type: "number", value: settings.dca.dailyAmount, onChange: (v: string) => updateDca("dailyAmount", parseFloat(v) || 0) },
    { label: "BTC held", type: "number", value: settings.dca.btcHeld, onChange: (v: string) => updateDca("btcHeld", parseFloat(v) || 0), step: "0.00000001" },
    { label: "Goal BTC", type: "number", value: settings.dca.goalBtc, onChange: (v: string) => updateDca("goalBtc", parseFloat(v) || 0), step: "0.001" },
  ];

  return (
    <>
      <div className="flex items-baseline gap-4 mb-7">
        <h2 style={{ fontFamily: "'Orbitron',monospace", fontSize: "1.1rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".12em", background: "linear-gradient(45deg,#f7931a,#00c8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingBottom: 10, position: "relative" }}>
          Settings
          <span style={{ position: "absolute", bottom: 0, left: 0, width: 40, height: 2, background: "linear-gradient(90deg,#f7931a,#00c8ff)", boxShadow: "0 0 10px rgba(247,147,26,.6)" }} />
        </h2>
      </div>

      <div className="flex flex-col gap-5" style={{ maxWidth: 900 }}>
        {/* DCA Stack */}
        <div style={gc}>
          <p style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--t2)", marginBottom: 12, fontFamily: "'Orbitron',monospace", letterSpacing: ".06em", textTransform: "uppercase" }}>DCA Stack</p>
          <div className="flex gap-2.5 flex-wrap">
            {dcaFields.map((field: DcaField) => (
              <label key={field.label} className="flex flex-col gap-1 flex-1" style={{ minWidth: 100 }}>
                <span style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em" }}>{field.label}</span>
                <input type={field.type} value={field.value}
                  onChange={e => field.onChange(e.target.value)}
                  step={field.step}
                  style={inputStyle} />
              </label>
            ))}
          </div>
        </div>

        {/* Watchlist */}
        <div style={gc}>
          <p style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--t2)", marginBottom: 12, fontFamily: "'Orbitron',monospace", letterSpacing: ".06em", textTransform: "uppercase" }}>
            Watchlist <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.2)", fontWeight: 400, fontFamily: "'Inter',sans-serif", textTransform: "none", letterSpacing: 0 }}>pinned in markets</span>
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {settings.polymarket.keywords.map((kw: string, i: number) => (
              <span key={i} className="inline-flex items-center gap-1" style={{ padding: "4px 10px", background: "rgba(247,147,26,.07)", border: "1px solid rgba(247,147,26,.2)", borderRadius: 3, fontSize: ".68rem", color: "var(--t2)" }}>
                {kw}
                <button onClick={() => removeKeyword(i)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.25)", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addKeyword()}
              placeholder="Add keyword…" style={{ ...inputStyle, minWidth: 120, flex: 1 }} />
            <button onClick={addKeyword} className="btn-ghost" style={{ whiteSpace: "nowrap" }}>Add</button>
          </div>
        </div>

        {/* News Feeds */}
        <div style={gc}>
          <p style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--t2)", marginBottom: 12, fontFamily: "'Orbitron',monospace", letterSpacing: ".06em", textTransform: "uppercase" }}>
            News Feeds <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.2)", fontWeight: 400, fontFamily: "'Inter',sans-serif", textTransform: "none", letterSpacing: 0 }}>toggle on/off · add custom</span>
          </p>

          <p style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Default Feeds</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {settings.news.defaultFeeds.map((feed: RssFeed, i: number) => (
              <label key={i} className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", fontSize: ".68rem", color: "var(--t2)" }}>
                <input type="checkbox" checked={feed.enabled} onChange={() => toggleDefaultFeed(i)} style={{ accentColor: "var(--orange)", width: 13, height: 13, cursor: "pointer" }} />
                <span style={{ fontSize: ".65rem", fontWeight: 500, color: feed.enabled ? "var(--t1)" : "var(--t2)" }}>{feed.name}</span>
              </label>
            ))}
          </div>

          {settings.news.customFeeds.length > 0 && (
            <>
              <p style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em", margin: "12px 0 6px" }}>Custom Feeds</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {settings.news.customFeeds.map((feed: RssFeed, i: number) => (
                  <div key={i} className="flex items-center gap-1">
                    <label className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", fontSize: ".68rem" }}>
                      <input type="checkbox" checked={feed.enabled} onChange={() => toggleCustomFeed(i)} style={{ accentColor: "var(--orange)", width: 13, height: 13, cursor: "pointer" }} />
                      <span style={{ fontSize: ".65rem", fontWeight: 500, color: feed.enabled ? "var(--t1)" : "var(--t2)" }}>{feed.name}</span>
                    </label>
                    <button onClick={() => removeSource(i)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.25)", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            </>
          )}

          <p style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em", margin: "12px 0 6px" }}>Add Custom Feed</p>
          <div className="flex gap-2 flex-wrap">
            <input type="url" value={newSource} onChange={e => setNewSource(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSource()}
              placeholder="https://example.com/feed.xml" style={{ ...inputStyle, flex: 2, minWidth: 120 }} />
            <input value={newSourceName} onChange={e => setNewSourceName(e.target.value)}
              placeholder="Feed name (optional)" style={{ ...inputStyle, flex: 1, minWidth: 80 }} />
            <button onClick={addSource} className="btn-ghost" style={{ whiteSpace: "nowrap" }}>Add</button>
          </div>
        </div>

        {/* Ghostfolio */}
        <div style={gc}>
          <p style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--t2)", marginBottom: 12, fontFamily: "'Orbitron',monospace", letterSpacing: ".06em", textTransform: "uppercase" }}>
            Ghostfolio <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.2)", fontWeight: 400, fontFamily: "'Inter',sans-serif", textTransform: "none", letterSpacing: 0 }}>token stored locally</span>
          </p>
          <div className="flex gap-2.5 flex-wrap" style={{ maxWidth: 500 }}>
            <label className="flex flex-col gap-1 flex-[3]" style={{ minWidth: 200 }}>
              <span style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em" }}>Security token</span>
              <input type="password" value={settings.ghostfolio.token}
                onChange={e => {
                  const next: Settings = { ...settings, ghostfolio: { ...settings.ghostfolio, token: e.target.value } };
                  setSettings(next);
                }}
                placeholder="your-security-token" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1" style={{ minWidth: 60 }}>
              <span style={{ fontSize: ".58rem", color: "var(--t2)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".1em" }}>Currency</span>
              <input value={settings.ghostfolio.currency}
                onChange={e => {
                  const next: Settings = { ...settings, ghostfolio: { ...settings.ghostfolio, currency: e.target.value } };
                  setSettings(next);
                }}
                placeholder="AUD" style={{ ...inputStyle, maxWidth: 80 }} />
            </label>
          </div>
        </div>

        {/* Save button */}
        <button onClick={handleSave} className="btn-primary" style={{ alignSelf: "flex-start", ...(saved ? { background: "linear-gradient(45deg,#22c55e,#15803d)" } : {}) }}>
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>
    </>
  );
}
