import { useEffect, useRef, useState } from "react";

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

const BLOCKS_TTL        = 60_000;
const MEMPOOL_TTL       = 30_000;
const DIFF_TTL          = 5 * 60_000;
const FEES_TTL          = 60_000;

const POLL_MS           = 60_000;
const MAX_BLOCKS        = 6;
const HALVING_INTERVAL  = 210_000;
const SATS_PER_BTC      = 1e8;
const FEE_SEPARATOR     = " · ";
/** Max block weight in weight-units (4 WU per vbyte × 1,000,000 vbytes) */
const MAX_BLOCK_WEIGHT  = 4_000_000;
/** Approximate max block vsize in vbytes — used for pending-block fill */
const MAX_BLOCK_VSIZE   = 1_000_000;

// Block card dimensions — keep in sync with skeleton placeholders
const BLOCK_CARD_W            = "w-[108px]";
const PENDING_BLOCK_W         = "w-[120px]";
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
const GLOW_PULSE_DURATION   = "2.8s";
const PENDING_SEAL_DURATION = "0.8s";

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
  if (n > 5)  return "text-emerald-500 dark:text-emerald-400";
  if (n > 0)  return "text-blue-500 dark:text-blue-400";
  if (n > -5) return "text-yellow-500 dark:text-yellow-400";
  return "text-red-500 dark:text-red-400";
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ProgressRowProps {
  label:           string;
  pct:             number | null;
  percentageLabel: string | null;
  right:           string | null;
  /** CSS gradient string for the filled bar, e.g. "linear-gradient(to right, ...)" */
  gradient:        string;
  loading:         boolean;
}

function ProgressRow({ label, pct, percentageLabel, right, gradient, loading }: ProgressRowProps) {
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
        {loading ? (
          <div className="h-full w-2/5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        ) : pct !== null ? (
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, Math.max(0, pct))}%`,
              background: gradient,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

interface MiniStatProps {
  label:   string;
  value:   string;
  sub?:    string;
  color?:  string;
  loading: boolean;
}

function MiniStat({ label, value, sub, color = "text-gray-800 dark:text-white/90", loading }: MiniStatProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">
        {label}
      </span>
      {loading ? (
        <div className="h-4 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ) : (
        <span className={`text-xs font-bold tabular-nums leading-tight ${color}`}>{value}</span>
      )}
      {sub && !loading && (
        <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">{sub}</span>
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
      <div className={`flex-none ${PENDING_BLOCK_W} ${BLOCK_CARD_SKELETON_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
    );
  }

  return (
    /* Outer div: owns the 3D box-shadow + seal animation — no overflow clip so shadow shows */
    <div
      className={`flex-none ${PENDING_BLOCK_W} btc-block-3d-pending rounded-xl ${
        isSealing ? `animate-[btc-pending-seal_${PENDING_SEAL_DURATION}_ease-in-out_both]` : ""
      }`}
    >
      {/* Inner div: clips the rising fill & particles inside the card boundary */}
      <div className="relative overflow-hidden rounded-[10px] border-2 border-dashed border-amber-400/60 dark:border-amber-500/35 bg-gray-50 dark:bg-white/[0.025]">

        {/* Gradient fill — rises from the bottom */}
        {fillPct !== null && (
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-[1200ms] animate-[btc-fill-pulse_${FILL_PULSE_DURATION}_ease-in-out_infinite]`}
            style={{
              height: `${fillPct}%`,
              background:
                "linear-gradient(to top, rgba(245,158,11,0.28) 0%, rgba(251,191,36,0.10) 70%, transparent 100%)",
            }}
          />
        )}

        {/* Floating tx particles */}
        {PARTICLE_POSITIONS.map((leftPct, i) => (
          <div
            key={i}
            className={`absolute rounded-full bg-amber-400 dark:bg-amber-500 animate-[btc-tx-rise_${TX_RISE_DURATION}_ease-in_infinite]`}
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
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest leading-none">
              Next
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 animate-pulse shrink-0" />
          </div>

          <div className="text-sm font-bold tabular-nums text-gray-700 dark:text-gray-200 leading-tight">
            {nextHeight !== null ? `#${fmtNum(nextHeight)}` : "—"}
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

          {/* Fill bar */}
          {fillPct !== null && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-semibold leading-none">
                  {fillPct >= 100 ? "Full" : `${fillPct}%`}
                </span>
                <span className="text-[8px] text-gray-400 dark:text-gray-500 leading-none">fill</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-[1200ms]"
                  style={{
                    width: `${fillPct}%`,
                    background: "linear-gradient(to right, rgba(245,158,11,0.85), rgba(251,146,60,0.95))",
                  }}
                />
              </div>
            </div>
          )}
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
  const fullness = Math.min(100, Math.round((block.weight / MAX_BLOCK_WEIGHT) * 100));

  return (
    <div
      className={`flex-none ${BLOCK_CARD_W} rounded-xl border p-2.5 transition-all ${
        isLatest ? "btc-block-3d-latest" : "btc-block-3d"
      } ${
        isNew ? `animate-[btc-block-enter_${BLOCK_ENTER_DURATION}_ease-out_both]` : ""
      } ${
        isLatest
          ? `bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30 animate-[btc-glow-pulse_${GLOW_PULSE_DURATION}_ease-in-out_infinite]`
          : "bg-white border-gray-100 dark:bg-white/[0.025] dark:border-gray-800"
      }`}
    >
      {/* Height */}
      <div className={`text-sm font-bold tabular-nums leading-tight ${
        isLatest ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-200"
      }`}>
        #{fmtNum(block.height)}
      </div>

      {/* Time */}
      <div className={`text-[9px] mt-0.5 leading-none ${
        isLatest ? "text-orange-400/80 dark:text-orange-500/60" : "text-gray-400 dark:text-gray-500"
      }`}>
        {timeAgo(block.timestamp)} ago
      </div>

      {/* Key-value detail rows — directly below, no flex-1 spacer */}
      <div className="space-y-1 mt-2.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">Txs</span>
          <span className="text-[9px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 leading-none">
            {fmtNum(block.tx_count)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">Size</span>
          <span className="text-[9px] tabular-nums text-gray-500 dark:text-gray-400 leading-none">
            {fmtBytes(block.size)}
          </span>
        </div>
        {reward != null && (
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">Reward</span>
            <span className="text-[9px] tabular-nums text-amber-500 dark:text-amber-400 leading-none">
              {fmtReward(reward)}
            </span>
          </div>
        )}
        {pool && (
          <div
            className={`text-[8px] truncate leading-none mt-0.5 ${
              isLatest ? "text-orange-400/70 dark:text-orange-500/60" : "text-gray-400 dark:text-gray-500"
            }`}
            title={pool}
          >
            {pool}
          </div>
        )}
      </div>

      {/* Fullness bar */}
      <div className="mt-2.5">
        <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${fullness}%`,
              background: isLatest
                ? "linear-gradient(to right, rgba(251,146,60,0.8), rgba(245,158,11,0.95))"
                : "rgba(156,163,175,0.6)",
            }}
          />
        </div>
        <div className={`text-[8px] tabular-nums mt-0.5 text-right leading-none ${
          isLatest ? "text-orange-400/70 dark:text-orange-500/60" : "text-gray-400 dark:text-gray-500"
        }`}>
          {fullness}%
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
      className={`flex-none ${BLOCK_CARD_W} btc-block-3d rounded-xl border border-gray-100 dark:border-gray-800 p-2.5 bg-gray-50 dark:bg-white/[0.015]`}
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
  const [loading,    setLoading]    = useState(true);

  const prevHeightRef             = useRef<number | null>(null);
  const [animatingBlockId,   setAnimatingBlockId]   = useState<string | null>(null);
  const [isSealingPending,   setIsSealingPending]   = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

      Promise.allSettled([fetchBlocks, fetchMempool, fetchDiff, fetchFees]).then(
        ([bRes, mRes, dRes, fRes]) => {
          if (signal.aborted) return;
          if (bRes.status === "fulfilled") setBlocks(bRes.value.slice(0, MAX_BLOCKS));
          if (mRes.status === "fulfilled") setMempool(mRes.value);
          if (dRes.status === "fulfilled") setDifficulty(dRes.value);
          if (fRes.status === "fulfilled") setFees(fRes.value);
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

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-start gap-2">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90 leading-tight">
              Blockchain
            </h3>
            {loading ? (
              <div className="h-5 w-28 mt-0.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ) : blockHeight !== null ? (
              <span className="text-xl font-bold tabular-nums text-gray-800 dark:text-white/90 leading-tight">
                #{fmtNum(blockHeight)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Live</span>
        </div>
      </div>

      {/* ── Progress bars: Halving + Epoch ── */}
      <div className="px-5 pb-3.5 space-y-3 shrink-0">
        <ProgressRow
          label="Halving"
          pct={halvingPct}
          percentageLabel={halvingPct !== null ? `${halvingPct.toFixed(1)}%` : null}
          right={blocksToHalving !== null ? `${fmtNum(blocksToHalving)} blocks left` : null}
          gradient="linear-gradient(to right, rgba(245,158,11,0.8), rgba(251,191,36,0.95))"
          loading={loading}
        />
        <ProgressRow
          label="Epoch"
          pct={epochProgress}
          percentageLabel={epochProgress !== null ? `${epochProgress.toFixed(1)}%` : null}
          right={remainingBlocks !== null ? `${fmtNum(remainingBlocks)} left` : null}
          gradient="linear-gradient(to right, rgba(251,146,60,0.8), rgba(239,68,68,0.7))"
          loading={loading}
        />
      </div>

      {/* ── Stats row ── */}
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
        <div className="grid grid-cols-4 gap-0 divide-x divide-gray-100 dark:divide-gray-800">
          <div className="pr-3">
            <MiniStat
              label="Est Diff"
              value={estDiffChange !== null ? fmtPct(estDiffChange) : "—"}
              color={pctColor(estDiffChange)}
              loading={loading}
            />
          </div>
          <div className="px-3">
            <MiniStat
              label="Last Diff"
              value={lastDiffChange !== null ? fmtPct(lastDiffChange) : "—"}
              color={pctColor(lastDiffChange)}
              loading={loading}
            />
          </div>
          <div className="px-3">
            <MiniStat
              label="Mempool"
              value={mempoolCount !== null ? fmtNum(mempoolCount) : "—"}
              sub={avgFeeRate !== null ? `${avgFeeRate} sat/vB` : undefined}
              loading={loading}
            />
          </div>
          <div className="pl-3">
            <MiniStat
              label="Fees sat/vB"
              value={feeStr}
              sub={feeSub}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {/* ── Live Chain — fills remaining height, cards float at natural height ── */}
      <div className="flex-1 min-h-0 flex flex-col px-5 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-white/[0.008]">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Live Chain
          </span>
          <span className="text-[9px] text-gray-400 dark:text-gray-500">older →</span>
        </div>

        {/* Scrollable chain row — items-center keeps cards at natural height, centered */}
        <div className="flex-1 min-h-0 flex items-center overflow-x-auto pb-1">

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
    </div>
  );
}
