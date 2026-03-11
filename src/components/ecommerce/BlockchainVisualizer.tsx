import { useEffect, useRef, useState } from "react";
import { CubeBlockIcon } from "../../icons";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlockExtras {
  reward?:     number;
  totalFees?:  number;
  avgFeeRate?: number;
  pool?:       { name: string };
  medianFee?:  number;
}

interface Block {
  id:        string;
  height:    number;
  timestamp: number;
  tx_count:  number;
  size:      number;
  weight:    number;
  extras?:   BlockExtras;
}

interface MempoolInfo {
  count:     number;
  vsize:     number;
  total_fee: number;
}

interface DifficultyAdjustment {
  progressPercent:       number;
  difficultyChange:      number;
  estimatedRetargetDate: number;
  remainingBlocks:       number;
  remainingTime:         number;
  previousRetarget:      number;
  nextRetargetHeight:    number;
  timeAvg:               number;
}

interface RecommendedFees {
  fastestFee:  number;
  halfHourFee: number;
  hourFee:     number;
  economyFee:  number;
  minimumFee:  number;
}

interface HashrateEntry {
  timestamp: number;
  avgHashrate: number;
}

interface HashrateResponse {
  hashrates: HashrateEntry[];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

type CacheEntry<T> = { data: T; fetchedAt: number };

function getCache<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.fetchedAt > ttl) return null;
    return entry.data;
  } catch { return null; }
}

function setCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* quota */ }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCKS_KEY        = "btc-blocks-v1";
const MEMPOOL_KEY       = "btc-mempool-v1";
const DIFF_KEY          = "btc-diff-adj-v1";
const FEES_KEY          = "btc-fees-v1";
const HASHRATE_KEY      = "btc-hashrate-v1";

const BLOCKS_TTL        = 60_000;
const MEMPOOL_TTL       = 30_000;
const DIFF_TTL          = 5 * 60_000;
const FEES_TTL          = 60_000;
const HASHRATE_TTL      = 5 * 60_000;

const POLL_MS           = 60_000;
const MAX_BLOCKS        = 6;
const HALVING_INTERVAL  = 210_000;
const SATS_PER_BTC      = 1e8;
const FEE_SEPARATOR     = " · ";
/** Approximate max block vsize in vbytes — used for pending-block fill */
const MAX_BLOCK_VSIZE   = 1_000_000;
/** Confirmed-block waterfill scale: 0 tx empty, 2500 tx full */
const MAX_BLOCK_TX_FILL = 2_500;

// Block card dimensions — keep in sync with skeleton placeholders
const BLOCK_CARD_W            = "w-[120px]";
/** Fixed height for loading skeleton cards — matches natural card height */
const BLOCK_CARD_SKELETON_H   = "h-[120px]";

// Animation timing
const BLOCK_ENTER_MS              = 600;
const ANIMATION_CLEANUP_BUFFER_MS = 150;
const PENDING_SEAL_MS             = 800;
/** Duration strings (must match paired CSS keyframe durations) */
const BLOCK_ENTER_DURATION  = "0.6s";
const FILL_PULSE_DURATION   = "3s";
const TX_RISE_DURATION      = "2.4s";
const PENDING_SEAL_DURATION = "0.8s";
const CHAIN_SNAP_BACK_MS    = 2600;
const CHAIN_SNAP_ANIM_MS    = 320;

// Particle config
const PARTICLE_POSITIONS       = [10, 32, 58, 82] as const;
const PARTICLE_STAGGER_S       = 0.6;
/** Fallback bottom % when fill is 0 so particles are still visible */
const PARTICLE_BOTTOM_FALLBACK = 40;

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(unixSec: number): string {
  const s = Math.floor(Date.now() / 1000 - unixSec);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} MB`;
  if (b >= 1_000)     return `${(b / 1_000).toFixed(0)} KB`;
  return `${b} B`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtReward(sats: number): string {
  return `${(sats / SATS_PER_BTC).toFixed(4)} ₿`;
}

function pctColor(n: number | null): string {
  if (n === null) return "text-gray-400 dark:text-gray-500";
  if (n > 0) return "text-positive";
  if (n < 0) return "text-negative";
  return "text-gray-400 dark:text-gray-500";
}

function pctDotColor(n: number | null): string {
  if (n === null) return "bg-gray-300 dark:bg-gray-600";
  if (n > 0) return "bg-positive";
  if (n < 0) return "bg-red-400";
  return "bg-gray-300 dark:bg-gray-600";
}

function getCycleGradient(progressPct: number): string {
  void progressPct;
  return "linear-gradient(to right, #FFD700, #FFC700, #FF8C00, #FF4500, #FF0000, #B22222, #CD5C5C, #E0FFFF)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ProgressRowProps {
  label:           string;
  pct:             number | null;
  percentageLabel: string | null;
  right:           React.ReactNode;
  /** CSS gradient string for the filled bar, e.g. "linear-gradient(to right, ...)" */
  gradient:        string;
  loading:         boolean;
}

function ProgressRow({ label, pct, percentageLabel, right, gradient, loading }: ProgressRowProps) {
  const [displayedPct, setDisplayedPct] = useState(0);

  useEffect(() => {
    if (loading || pct === null) {
      setDisplayedPct(0);
      return;
    }

    // Match DCA feel: render 0 first, then animate left->right on next paint.
    setDisplayedPct(0);
    let frame1 = 0;
    let frame2 = 0;
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setDisplayedPct(Math.min(100, Math.max(0, pct)));
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [pct, loading]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {label}
          </span>
          {!loading && percentageLabel && (
            <span className="text-[10px] tabular-nums font-medium text-gray-500 dark:text-gray-400">
              {percentageLabel}
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ) : right ? (
          <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">{right}</span>
        ) : null}
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${displayedPct}%`,
            background: gradient,
            // Anchor gradient to full track width; reveal it progressively via fill width.
            backgroundSize: `${10000 / Math.max(displayedPct, 1)}% 100%`,
            backgroundPosition: "left center",
            backgroundRepeat: "no-repeat",
          }}
        />
      </div>
    </div>
  );
}

interface MiniStatProps {
  label:   string;
  value:   string;
  sub?:    string;
  active?: boolean;
  valueColor?: string;
  dotColor?: string;
  loading: boolean;
}

function MiniStat({
  label,
  value,
  sub,
  active = false,
  valueColor = "text-gray-800 dark:text-white/90",
  dotColor = "bg-gray-300 dark:bg-gray-600",
  loading,
}: MiniStatProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5 min-w-0 text-center">
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${loading ? "bg-gray-300 dark:bg-gray-600" : dotColor}`} />
        <span
          className={`text-[10px] font-semibold leading-tight transition-colors duration-300 ${
            active ? "text-gray-800 dark:text-white/90" : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {label}
        </span>
      </div>

      {loading ? (
        <div className="h-3.5 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ) : (
        <span className={`text-[10px] tabular-nums transition-colors duration-300 ${active ? valueColor : "text-gray-400 dark:text-gray-500"}`}>
          {value}
        </span>
      )}

      {sub && !loading && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-none">{sub}</span>
      )}
    </div>
  );
}

// ── Pending Block ─────────────────────────────────────────────────────────────

interface PendingBlockProps {
  nextHeight:   number | null;
  mempoolCount: number | null;
  mempoolVsize: number | null;
  avgFeeRate:   number | null;
  loading:      boolean;
  isSealing:    boolean;
}

function PendingBlock({
  nextHeight, mempoolCount, mempoolVsize, avgFeeRate, loading, isSealing,
}: PendingBlockProps) {
  const fillPct = mempoolVsize !== null
    ? Math.min(100, Math.round((mempoolVsize / MAX_BLOCK_VSIZE) * 100))
    : null;

  if (loading) {
    return (
      <div className={`flex-none w-[120px] ${BLOCK_CARD_SKELETON_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
    );
  }

  return (
    /* Flat 2D pending card shell (same size; outlined inner card) */
    <div
      className={`flex-none w-[120px] ${BLOCK_CARD_SKELETON_H} rounded-xl ${
        isSealing ? `animate-[btc-pending-seal_${PENDING_SEAL_DURATION}_ease-in-out_both]` : ""
      }`}
    >
      {/* Inner div: clips the rising fill & particles inside the card boundary */}
      <div className="relative h-full overflow-hidden rounded-[10px] border-2 border-dashed border-yellow-400/70 dark:border-yellow-300/45 bg-gray-50 dark:bg-white/[0.025]">

        {/* Gradient fill — rises from the bottom */}
        {fillPct !== null && (
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-[1200ms] animate-[btc-fill-pulse_${FILL_PULSE_DURATION}_ease-in-out_infinite]`}
            style={{
              height: `${fillPct}%`,
              background:
                "linear-gradient(to top, rgba(250,204,21,0.32) 0%, rgba(254,240,138,0.16) 70%, transparent 100%)",
            }}
          />
        )}

        {/* Floating tx particles */}
        {PARTICLE_POSITIONS.map((leftPct, i) => (
          <div
            key={i}
            className={`absolute rounded-full bg-yellow-400 dark:bg-yellow-300 animate-[btc-tx-rise_${TX_RISE_DURATION}_ease-in_infinite]`}
            style={{
              width:          i % 2 === 0 ? "5px" : "4px",
              height:         i % 2 === 0 ? "5px" : "4px",
              left:           `${leftPct}%`,
              bottom:         `${fillPct ?? PARTICLE_BOTTOM_FALLBACK}%`,
              animationDelay: `${i * PARTICLE_STAGGER_S}s`,
              opacity: 0,
            }}
          />
        ))}

        {/* Card content — stacked naturally, no flex-1 spacer */}
        <div className="relative z-10 p-2.5">
          <div className="mb-1 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <CubeBlockIcon className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-300" aria-hidden="true" />
              <span className="text-sm font-bold tabular-nums text-gray-700 dark:text-gray-200 leading-tight">
                {nextHeight !== null ? fmtNum(nextHeight) : "—"}
              </span>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 dark:bg-yellow-300 animate-pulse shrink-0" aria-label="Live" />
          </div>

          {/* Stats */}
          <div className="space-y-1 mt-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-gray-500 dark:text-gray-400 leading-none">Pending</span>
              <span className="text-[9px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 leading-none">
                {mempoolCount !== null ? fmtNum(mempoolCount) : "—"}
              </span>
            </div>
            {avgFeeRate !== null && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] text-gray-500 dark:text-gray-400 leading-none">Avg fee</span>
                <span className="text-[9px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 leading-none">
                  {avgFeeRate} sat/vB
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Confirmed Block Card ──────────────────────────────────────────────────────

interface BlockCardProps {
  block:    Block;
  isLatest: boolean;
  isNew:    boolean;
}

function BlockCard({ block, isLatest, isNew }: BlockCardProps) {
  const reward   = block.extras?.reward;
  const pool     = block.extras?.pool?.name;
  const txFillPct = Math.min(100, Math.round((block.tx_count / MAX_BLOCK_TX_FILL) * 100));

  return (
    <div
      className={`relative overflow-hidden flex-none ${BLOCK_CARD_W} ${BLOCK_CARD_SKELETON_H} rounded-xl border p-2.5 transition-all ${
        isNew ? `animate-[btc-block-enter_${BLOCK_ENTER_DURATION}_ease-out_both]` : ""
      } bg-white border-gray-100 dark:bg-white/[0.025] dark:border-gray-800`}
    >
      {/* Completed-block water fill — same color for all confirmed blocks */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 transition-all duration-700"
        style={{
          height: `${txFillPct}%`,
          background: "linear-gradient(to top, rgba(249,115,22,0.24) 0%, rgba(253,186,116,0.10) 68%, transparent 100%)",
        }}
      />

      <div className="relative z-10">
        {/* Height */}
        <div className="flex items-center gap-1">
          <CubeBlockIcon
            className={`h-3.5 w-3.5 ${isLatest ? "text-gray-900 dark:text-white" : "text-gray-900 dark:text-gray-100"}`}
            aria-hidden="true"
          />
          <span className={`text-sm font-bold tabular-nums leading-tight ${
            isLatest ? "text-gray-900 dark:text-white" : "text-gray-900 dark:text-gray-100"
          }`}>
            {fmtNum(block.height)}
          </span>
        </div>

        {/* Time */}
        <div className="text-[9px] mt-0.5 leading-none text-gray-700 dark:text-gray-300">
          {timeAgo(block.timestamp)} ago
        </div>

        {/* Key-value detail rows */}
        <div className="space-y-1 mt-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] text-gray-700 dark:text-gray-300 leading-none">Txs</span>
            <span className="text-[9px] font-semibold tabular-nums text-gray-900 dark:text-white leading-none">
              {fmtNum(block.tx_count)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] text-gray-700 dark:text-gray-300 leading-none">Size</span>
            <span className="text-[9px] tabular-nums text-gray-900 dark:text-white leading-none">
              {fmtBytes(block.size)}
            </span>
          </div>
          {reward != null && (
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-gray-700 dark:text-gray-300 leading-none">Reward</span>
              <span className="text-[9px] tabular-nums text-gray-900 dark:text-white leading-none">
                {fmtReward(reward)}
              </span>
            </div>
          )}
          {pool && (
            <div
              className="text-[8px] truncate leading-none mt-0.5 text-gray-700 dark:text-gray-300"
              title={pool}
            >
              {pool}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ghost Block (empty-state placeholder) ────────────────────────────────────

/** Shown when blocks have not loaded — mirrors the real BlockCard layout with muted shimmers */
function GhostBlockCard() {
  return (
    <div
      className={`flex-none ${BLOCK_CARD_W} rounded-xl border border-gray-100 dark:border-gray-800 p-2.5 bg-gray-50 dark:bg-white/[0.015]`}
    >
      {/* Height placeholder */}
      <div className="h-[14px] w-[56px] rounded bg-gray-100 dark:bg-gray-800" />
      {/* Time placeholder */}
      <div className="h-[10px] w-[36px] rounded bg-gray-100/70 dark:bg-gray-800/70 mt-1" />

      {/* Detail row placeholders — stacked directly, no spacer */}
      <div className="space-y-1.5 mt-2.5">
        <div className="flex items-center justify-between gap-1">
          <div className="h-[9px] w-[16px] rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-[9px] w-[32px] rounded bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-[9px] w-[20px] rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-[9px] w-[28px] rounded bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-[9px] w-[28px] rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-[9px] w-[40px] rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>

      {/* Fullness bar placeholder */}
      <div className="mt-2.5 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

/** Directional arrow connecting blocks in the chain; `isPrimary` = pending→latest */
function ChainArrow({ isPrimary = false }: { isPrimary?: boolean }) {
  const lineColor  = isPrimary
    ? "bg-amber-300 dark:bg-amber-600/50"
    : "bg-gray-200 dark:bg-gray-700";
  const arrowColor = isPrimary
    ? "border-l-amber-300 dark:border-l-amber-600/50"
    : "border-l-gray-200 dark:border-l-gray-700";
  return (
    <div className="flex items-center mx-1.5 shrink-0">
      <div className={`w-4 h-px ${lineColor}`} />
      <div className={`w-0 h-0 border-t-[3.5px] border-b-[3.5px] border-l-[6px] border-t-transparent border-b-transparent ${arrowColor}`} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BlockchainVisualizer() {
  const [blocks,     setBlocks]     = useState<Block[]>([]);
  const [mempool,    setMempool]    = useState<MempoolInfo | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyAdjustment | null>(null);
  const [fees,       setFees]       = useState<RecommendedFees | null>(null);
  const [hashrate,   setHashrate]   = useState<HashrateResponse | null>(null);
  const [loading,    setLoading]    = useState(true);

  const prevHeightRef             = useRef<number | null>(null);
  const [animatingBlockId,   setAnimatingBlockId]   = useState<string | null>(null);
  const [isSealingPending,   setIsSealingPending]   = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chainScrollRef = useRef<HTMLDivElement | null>(null);
  const chainSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainSnapRafRef = useRef<number | null>(null);
  const isProgrammaticChainScrollRef = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;

    function doFetch(bust = false) {
      const fetchBlocks: Promise<Block[]> = (() => {
        const c = bust ? null : getCache<Block[]>(BLOCKS_KEY, BLOCKS_TTL);
        if (c) return Promise.resolve(c);
        return fetch("https://mempool.space/api/v1/blocks", { signal })
          .then((r) => { if (!r.ok) throw new Error(`blocks ${r.status}`); return r.json() as Promise<Block[]>; })
          .then((d) => { setCache(BLOCKS_KEY, d); return d; });
      })();

      const fetchMempool: Promise<MempoolInfo> = (() => {
        const c = bust ? null : getCache<MempoolInfo>(MEMPOOL_KEY, MEMPOOL_TTL);
        if (c) return Promise.resolve(c);
        return fetch("https://mempool.space/api/mempool", { signal })
          .then((r) => { if (!r.ok) throw new Error(`mempool ${r.status}`); return r.json() as Promise<MempoolInfo>; })
          .then((d) => { setCache(MEMPOOL_KEY, d); return d; });
      })();

      const fetchDiff: Promise<DifficultyAdjustment> = (() => {
        const c = bust ? null : getCache<DifficultyAdjustment>(DIFF_KEY, DIFF_TTL);
        if (c) return Promise.resolve(c);
        return fetch("https://mempool.space/api/v1/difficulty-adjustment", { signal })
          .then((r) => { if (!r.ok) throw new Error(`diff ${r.status}`); return r.json() as Promise<DifficultyAdjustment>; })
          .then((d) => { setCache(DIFF_KEY, d); return d; });
      })();

      const fetchFees: Promise<RecommendedFees> = (() => {
        const c = bust ? null : getCache<RecommendedFees>(FEES_KEY, FEES_TTL);
        if (c) return Promise.resolve(c);
        return fetch("https://mempool.space/api/v1/fees/recommended", { signal })
          .then((r) => { if (!r.ok) throw new Error(`fees ${r.status}`); return r.json() as Promise<RecommendedFees>; })
          .then((d) => { setCache(FEES_KEY, d); return d; });
      })();

      const fetchHashrate: Promise<HashrateResponse> = (() => {
        const c = bust ? null : getCache<HashrateResponse>(HASHRATE_KEY, HASHRATE_TTL);
        if (c) return Promise.resolve(c);
        return fetch("https://mempool.space/api/v1/mining/hashrate/3d", { signal })
          .then((r) => { if (!r.ok) throw new Error(`hashrate ${r.status}`); return r.json() as Promise<HashrateResponse>; })
          .then((d) => { setCache(HASHRATE_KEY, d); return d; });
      })();

      Promise.allSettled([fetchBlocks, fetchMempool, fetchDiff, fetchFees, fetchHashrate]).then(
        ([bRes, mRes, dRes, fRes, hRes]) => {
          if (signal.aborted) return;
          if (bRes.status === "fulfilled") setBlocks(bRes.value.slice(0, MAX_BLOCKS));
          if (mRes.status === "fulfilled") setMempool(mRes.value);
          if (dRes.status === "fulfilled") setDifficulty(dRes.value);
          if (fRes.status === "fulfilled") setFees(fRes.value);
          if (hRes.status === "fulfilled") setHashrate(hRes.value);
          setLoading(false);
        }
      );
    }

    doFetch();
    timerRef.current = setInterval(() => doFetch(true), POLL_MS);

    return () => {
      ctrl.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Snap the live chain back to its starting position after the user stops scrolling.
  useEffect(() => {
    return () => {
      if (chainSnapTimerRef.current) clearTimeout(chainSnapTimerRef.current);
      if (chainSnapRafRef.current !== null) cancelAnimationFrame(chainSnapRafRef.current);
    };
  }, []);

  function animateChainSnapBack(el: HTMLDivElement): void {
    if (chainSnapRafRef.current !== null) cancelAnimationFrame(chainSnapRafRef.current);

    const startLeft = el.scrollLeft;
    if (startLeft <= 0) return;

    const startTime = performance.now();
    const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / CHAIN_SNAP_ANIM_MS);
      const eased = easeOutQuad(t);
      isProgrammaticChainScrollRef.current = true;
      el.scrollLeft = startLeft * (1 - eased);

      if (t < 1) {
        chainSnapRafRef.current = requestAnimationFrame(step);
      } else {
        isProgrammaticChainScrollRef.current = false;
        chainSnapRafRef.current = null;
      }
    };

    chainSnapRafRef.current = requestAnimationFrame(step);
  }

  function onChainScroll(): void {
    if (isProgrammaticChainScrollRef.current) return;

    if (chainSnapTimerRef.current) clearTimeout(chainSnapTimerRef.current);
    if (chainSnapRafRef.current !== null) {
      cancelAnimationFrame(chainSnapRafRef.current);
      chainSnapRafRef.current = null;
    }

    chainSnapTimerRef.current = setTimeout(() => {
      const el = chainScrollRef.current;
      if (!el) return;
      if (el.scrollLeft <= 0) return;
      animateChainSnapBack(el);
    }, CHAIN_SNAP_BACK_MS);
  }

  // ── Detect new block → trigger animations ────────────────────────────────
  useEffect(() => {
    if (loading || blocks.length === 0) return;
    const latestHeight = blocks[0].height;
    const latestId     = blocks[0].id;
    if (prevHeightRef.current !== null && latestHeight !== prevHeightRef.current) {
      setAnimatingBlockId(latestId);
      setIsSealingPending(true);
      const t1 = setTimeout(() => setAnimatingBlockId(null),  BLOCK_ENTER_MS  + ANIMATION_CLEANUP_BUFFER_MS);
      const t2 = setTimeout(() => setIsSealingPending(false), PENDING_SEAL_MS + ANIMATION_CLEANUP_BUFFER_MS);
      prevHeightRef.current = latestHeight;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    prevHeightRef.current = latestHeight;
  }, [blocks, loading]);

  // ── Derived values ────────────────────────────────────────────────────────
  const blockHeight = blocks[0]?.height ?? null;

  const halvingCompleted = blockHeight !== null ? blockHeight % HALVING_INTERVAL : null;
  const halvingPct       = halvingCompleted !== null ? (halvingCompleted / HALVING_INTERVAL) * 100 : null;
  const blocksToHalving  = halvingCompleted !== null ? HALVING_INTERVAL - halvingCompleted : null;

  const epochProgress   = difficulty?.progressPercent ?? null;
  const estDiffChange   = difficulty?.difficultyChange ?? null;
  const lastDiffChange  = difficulty?.previousRetarget ?? null;
  const remainingBlocks = difficulty?.remainingBlocks ?? null;

  const mempoolCount = mempool?.count ?? null;
  const mempoolVsize = mempool?.vsize ?? null;
  const avgFeeRate   =
    mempoolVsize && mempool?.total_fee
      ? Math.round(mempool.total_fee / mempoolVsize)
      : null;

  const feeStr = fees
    ? `${fees.fastestFee}${FEE_SEPARATOR}${fees.halfHourFee}${FEE_SEPARATOR}${fees.hourFee}`
    : "—";
  const feeSub = fees ? `fast${FEE_SEPARATOR}mid${FEE_SEPARATOR}slow` : undefined;

  // Latest hashrate in EH/s
  const latestHashrate = hashrate?.hashrates?.length
    ? hashrate.hashrates[hashrate.hashrates.length - 1].avgHashrate / 1e18
    : null;
  const hashrateStr = latestHashrate !== null
    ? `${latestHashrate.toFixed(1)} EH/s`
    : "—";

  return (
    <section className="w-full px-1 py-1 sm:px-0">

      {/* ── Header ── */}
      <div className="pt-2 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <CubeBlockIcon className="h-6 w-6 text-brand-500" aria-label="Block" />
          {loading ? (
            <div className="h-7 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : blockHeight !== null ? (
            <span className="text-3xl font-semibold tabular-nums leading-none text-white sm:text-4xl">
              {fmtNum(blockHeight)}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Progress bars: Halving + Epoch ── */}
      <div className="pb-3.5 space-y-3 shrink-0">
        <ProgressRow
          label="Halving"
          pct={halvingPct}
          percentageLabel={halvingPct !== null ? `${halvingPct.toFixed(1)}%` : null}
          right={blocksToHalving !== null ? (
            <span className="flex items-center gap-0.5 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
              <CubeBlockIcon className="h-[8px] w-[8px]" aria-hidden="true" />
              {fmtNum(blocksToHalving)}
            </span>
          ) : null}
          gradient={getCycleGradient(halvingPct ?? 0)}
          loading={loading}
        />
        <ProgressRow
          label="Epoch"
          pct={epochProgress}
          percentageLabel={epochProgress !== null ? `${epochProgress.toFixed(1)}%` : null}
          right={remainingBlocks !== null ? (
            <span className="flex items-center gap-0.5 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
              <CubeBlockIcon className="h-[8px] w-[8px]" aria-hidden="true" />
              {fmtNum(remainingBlocks)}
            </span>
          ) : null}
          gradient={getCycleGradient(epochProgress ?? 0)}
          loading={loading}
        />
      </div>

      {/* ── Stats row ── */}
      <div className="py-3 shrink-0">
        <div className="grid grid-cols-4 gap-1">
          <div>
            <MiniStat
              label="Est Diff"
              value={estDiffChange !== null ? fmtPct(estDiffChange) : "—"}
              active={estDiffChange !== null}
              valueColor={pctColor(estDiffChange)}
              dotColor={pctDotColor(estDiffChange)}
              loading={loading}
            />
          </div>
          <div>
            <MiniStat
              label="Last Diff"
              value={lastDiffChange !== null ? fmtPct(lastDiffChange) : "—"}
              active={lastDiffChange !== null}
              valueColor={pctColor(lastDiffChange)}
              dotColor={pctDotColor(lastDiffChange)}
              loading={loading}
            />
          </div>
          <div>
            <MiniStat
              label="Hashrate"
              value={hashrateStr}
              active={latestHashrate !== null}
              valueColor="text-gray-800 dark:text-white/90"
              dotColor={latestHashrate !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}
              loading={loading}
            />
          </div>
          <div>
            <MiniStat
              label="Fees sat/vB"
              value={feeStr}
              sub={feeSub}
              active={fees !== null}
              valueColor="text-gray-800 dark:text-white/90"
              dotColor={fees !== null ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {/* ── Live Chain — fills remaining height, cards float at natural height ── */}
      <div className="flex-1 min-h-0 flex flex-col pb-3 pt-3">
        {/* Scrollable chain row — items-center keeps cards at natural height, centered */}
        <div
          ref={chainScrollRef}
          onScroll={onChainScroll}
          className="flex-1 min-h-0 flex items-center overflow-x-auto no-scrollbar pb-1"
        >

          {/* Pending block */}
          <div className="flex items-center shrink-0">
            <PendingBlock
              nextHeight={blockHeight !== null ? blockHeight + 1 : null}
              mempoolCount={mempoolCount}
              mempoolVsize={mempoolVsize}
              avgFeeRate={avgFeeRate}
              loading={loading}
              isSealing={isSealingPending}
            />
            <div className="flex items-center">
              <ChainArrow isPrimary />
            </div>
          </div>

          {/* Confirmed blocks */}
          {loading
            ? Array.from({ length: MAX_BLOCKS }).map((_, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <div className={`${BLOCK_CARD_W} ${BLOCK_CARD_SKELETON_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
                  {i < MAX_BLOCKS - 1 && (
                    <div className="flex items-center">
                      <ChainArrow />
                    </div>
                  )}
                </div>
              ))
            : blocks.length === 0
            ? Array.from({ length: MAX_BLOCKS }).map((_, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <GhostBlockCard />
                  {i < MAX_BLOCKS - 1 && (
                    <div className="flex items-center">
                      <ChainArrow />
                    </div>
                  )}
                </div>
              ))
            : blocks.map((block, i) => (
                <div key={block.id} className="flex items-center shrink-0">
                  <BlockCard
                    block={block}
                    isLatest={i === 0}
                    isNew={block.id === animatingBlockId}
                  />
                  {i < blocks.length - 1 && (
                    <div className="flex items-center">
                      <ChainArrow />
                    </div>
                  )}
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}
