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
const BLOCK_CARD_W          = "w-[96px]";
const PENDING_BLOCK_W       = "w-[110px]";
const BLOCK_CARD_SKELETON_H = "h-[118px]";
/** How long the btc-block-enter CSS animation plays (ms) */
const BLOCK_ENTER_MS        = 500;
/** Extra buffer after animation before clearing the animating-id state */
const ANIMATION_CLEANUP_BUFFER_MS = 150;
/** Duration string for the block-enter animation class (must match BLOCK_ENTER_MS) */
const BLOCK_ENTER_DURATION  = "0.5s";
/** Duration string for the pending-block fill pulse animation */
const FILL_PULSE_DURATION   = "3s";
/** Duration string for the tx-rise particle animation */
const TX_RISE_DURATION      = "2.6s";
/** Particle horizontal positions (%) and stagger delay (s) */
const PARTICLE_POSITIONS    = [16, 46, 76] as const;
const PARTICLE_STAGGER_S    = 0.9;
/** Bottom offset for particles — anchored to the fill level, capped at 50 to stay visible when fill is 0 */
const PARTICLE_BOTTOM_FALLBACK = 50;

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
  /** Tailwind bg-* class for the filled portion, e.g. "bg-amber-400" */
  color:           string;
  loading:         boolean;
}

function ProgressRow({ label, pct, percentageLabel, right, color, loading }: ProgressRowProps) {
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
      <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {loading ? (
          <div className="h-full w-2/5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        ) : pct !== null ? (
          <div
            className={`h-full rounded-full ${color} transition-all duration-700`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
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

// ── Pending Block ──────────────────────────────────────────────────────────────

interface PendingBlockProps {
  nextHeight:    number | null;
  mempoolCount:  number | null;
  mempoolVsize:  number | null;
  avgFeeRate:    number | null;
  loading:       boolean;
}

function PendingBlock({ nextHeight, mempoolCount, mempoolVsize, avgFeeRate, loading }: PendingBlockProps) {
  /** 0-100: how full the next block is based on mempool vsize vs 1 MB cap */
  const fillPct = mempoolVsize !== null
    ? Math.min(100, Math.round((mempoolVsize / MAX_BLOCK_VSIZE) * 100))
    : null;

  if (loading) {
    return (
      <div className={`flex-none ${PENDING_BLOCK_W} ${BLOCK_CARD_SKELETON_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
    );
  }

  return (
    <div
      className={`flex-none ${PENDING_BLOCK_W} relative overflow-hidden rounded-xl border-2 border-dashed border-amber-400/70 dark:border-amber-500/40 bg-white dark:bg-white/[0.02]`}
      style={{ minHeight: "118px" }}
    >
      {/* Animated fill background */}
      {fillPct !== null && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-amber-100/90 dark:bg-amber-500/15 animate-[btc-fill-pulse_${FILL_PULSE_DURATION}_ease-in-out_infinite] transition-all duration-1000`}
          style={{ height: `${fillPct}%` }}
        />
      )}

      {/* Floating tx particles */}
      {PARTICLE_POSITIONS.map((leftPct, i) => (
        <div
          key={i}
          className={`absolute w-1 h-1 rounded-full bg-amber-400 dark:bg-amber-500 animate-[btc-tx-rise_${TX_RISE_DURATION}_ease-in_infinite]`}
          style={{
            left:           `${leftPct}%`,
            bottom:         `${fillPct ?? PARTICLE_BOTTOM_FALLBACK}%`,
            animationDelay: `${i * PARTICLE_STAGGER_S}s`,
          }}
        />
      ))}

      {/* Content */}
      <div className="relative z-10 p-2">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide leading-none">
            Next
          </span>
          <span className="w-1 h-1 rounded-full bg-amber-400 dark:bg-amber-500 animate-pulse shrink-0" />
        </div>

        <div className="text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-200 leading-tight mb-1.5">
          {nextHeight !== null ? `#${fmtNum(nextHeight)}` : "—"}
        </div>

        <div className="space-y-0.5">
          <div className="text-[9px] tabular-nums text-gray-600 dark:text-gray-300">
            {mempoolCount !== null ? fmtNum(mempoolCount) : "—"} pending
          </div>
          {avgFeeRate !== null && (
            <div className="text-[9px] tabular-nums text-gray-500 dark:text-gray-400">
              {avgFeeRate} sat/vB
            </div>
          )}
          {fillPct !== null && (
            <div className="text-[9px] tabular-nums font-semibold text-amber-600 dark:text-amber-400">
              {fillPct >= 100 ? "Full" : `${fillPct}% full`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Confirmed Block Card ───────────────────────────────────────────────────────

interface BlockCardProps {
  block:    Block;
  isLatest: boolean;
  isNew:    boolean;
}

function BlockCard({ block, isLatest, isNew }: BlockCardProps) {
  const reward   = block.extras?.reward;
  const pool     = block.extras?.pool?.name;
  /** Block fullness 0-100 based on weight vs 4 MW max */
  const fullness = Math.min(100, Math.round((block.weight / MAX_BLOCK_WEIGHT) * 100));

  return (
    <div
      className={`flex-none ${BLOCK_CARD_W} rounded-xl border p-2 transition-colors ${
        isNew ? `animate-[btc-block-enter_${BLOCK_ENTER_DURATION}_ease-out_both]` : ""
      } ${
        isLatest
          ? "bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30"
          : "bg-gray-50 border-gray-100 dark:bg-white/[0.02] dark:border-gray-800"
      }`}
    >
      {/* Height */}
      <div className={`text-[11px] font-bold tabular-nums leading-tight ${
        isLatest ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-200"
      }`}>
        #{fmtNum(block.height)}
      </div>
      {/* Time */}
      <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1.5">
        {timeAgo(block.timestamp)} ago
      </div>
      {/* Details */}
      <div className="space-y-0.5 mb-2">
        <div className="text-[9px] tabular-nums text-gray-600 dark:text-gray-300">
          {fmtNum(block.tx_count)} txs
        </div>
        <div className="text-[9px] text-gray-400 dark:text-gray-500">
          {fmtBytes(block.size)}
        </div>
        {reward != null && (
          <div className="text-[9px] tabular-nums text-amber-500 dark:text-amber-400">
            {fmtReward(reward)}
          </div>
        )}
        {pool && (
          <div className="text-[8px] text-gray-400 dark:text-gray-500 truncate" title={pool}>
            {pool}
          </div>
        )}
      </div>
      {/* Fullness bar */}
      <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isLatest ? "bg-orange-400" : "bg-gray-300 dark:bg-gray-600"
          }`}
          style={{ width: `${fullness}%` }}
        />
      </div>
      <div className="text-[8px] tabular-nums text-gray-400 dark:text-gray-500 mt-0.5 text-right">
        {fullness}%
      </div>
    </div>
  );
}

/** Small directional arrow connector between blocks */
function ChainArrow({ faint = false }: { faint?: boolean }) {
  const lineColor  = faint ? "bg-gray-200 dark:bg-gray-700"   : "bg-gray-300 dark:bg-gray-600";
  const arrowColor = faint ? "border-l-gray-200 dark:border-l-gray-700" : "border-l-gray-300 dark:border-l-gray-600";
  return (
    <div className="flex items-center mx-1 shrink-0">
      <div className={`w-3 h-px ${lineColor}`} />
      <div className={`w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-t-transparent border-b-transparent ${arrowColor}`} />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BlockchainVisualizer() {
  const [blocks,     setBlocks]     = useState<Block[]>([]);
  const [mempool,    setMempool]    = useState<MempoolInfo | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyAdjustment | null>(null);
  const [fees,       setFees]       = useState<RecommendedFees | null>(null);
  const [loading,    setLoading]    = useState(true);

  /** Track latest block height to detect when a new block arrives */
  const prevHeightRef    = useRef<number | null>(null);
  const [animatingBlockId, setAnimatingBlockId] = useState<string | null>(null);

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

  // ── Detect new block → trigger slide-in animation ─────────────────────────
  useEffect(() => {
    if (loading || blocks.length === 0) return;
    const latestHeight = blocks[0].height;
    const latestId     = blocks[0].id;
    if (prevHeightRef.current !== null && latestHeight !== prevHeightRef.current) {
      setAnimatingBlockId(latestId);
      const t = setTimeout(() => setAnimatingBlockId(null), BLOCK_ENTER_MS + ANIMATION_CLEANUP_BUFFER_MS);
      prevHeightRef.current = latestHeight;
      return () => clearTimeout(t);
    }
    prevHeightRef.current = latestHeight;
  }, [blocks, loading]);

  // ── Derived values ────────────────────────────────────────────────────────
  const blockHeight = blocks[0]?.height ?? null;

  // Halving — computed from block height position within 210,000-block cycle
  const halvingCompleted = blockHeight !== null ? blockHeight % HALVING_INTERVAL : null;
  const halvingPct       = halvingCompleted !== null ? (halvingCompleted / HALVING_INTERVAL) * 100 : null;
  const blocksToHalving  = halvingCompleted !== null ? HALVING_INTERVAL - halvingCompleted : null;

  // Difficulty epoch
  const epochProgress   = difficulty?.progressPercent ?? null;
  const estDiffChange   = difficulty?.difficultyChange ?? null;
  const lastDiffChange  = difficulty?.previousRetarget ?? null;
  const remainingBlocks = difficulty?.remainingBlocks ?? null;

  // Mempool
  const mempoolCount = mempool?.count ?? null;
  const mempoolVsize = mempool?.vsize ?? null;
  const avgFeeRate   =
    mempoolVsize && mempool?.total_fee
      ? Math.round(mempool.total_fee / mempoolVsize)
      : null;

  // Fee display — "fast · mid · slow" using shared separator constant
  const feeStr = fees
    ? `${fees.fastestFee}${FEE_SEPARATOR}${fees.halfHourFee}${FEE_SEPARATOR}${fees.hourFee}`
    : "—";
  const feeSub = fees ? `fast${FEE_SEPARATOR}mid${FEE_SEPARATOR}slow` : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">

      {/* ── Header: title + block height + live dot ── */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 sm:px-5 sm:pt-5 shrink-0">
        <div className="flex items-start gap-2">
          <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400 mt-0.5">
            3
          </span>
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
      <div className="px-4 pb-3 sm:px-5 space-y-2.5 shrink-0">
        <ProgressRow
          label="Halving"
          pct={halvingPct}
          percentageLabel={halvingPct !== null ? `${halvingPct.toFixed(1)}%` : null}
          right={blocksToHalving !== null ? `${fmtNum(blocksToHalving)} blocks left` : null}
          color="bg-amber-400"
          loading={loading}
        />
        <ProgressRow
          label="Epoch"
          pct={epochProgress}
          percentageLabel={epochProgress !== null ? `${epochProgress.toFixed(1)}%` : null}
          right={remainingBlocks !== null ? `${fmtNum(remainingBlocks)} left` : null}
          color="bg-orange-400"
          loading={loading}
        />
      </div>

      {/* ── Condensed stats row ── */}
      <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3 shrink-0">
        <MiniStat
          label="Est. Diff Adj"
          value={estDiffChange !== null ? fmtPct(estDiffChange) : "—"}
          color={pctColor(estDiffChange)}
          loading={loading}
        />
        <MiniStat
          label="Last Diff Adj"
          value={lastDiffChange !== null ? fmtPct(lastDiffChange) : "—"}
          color={pctColor(lastDiffChange)}
          loading={loading}
        />
        <MiniStat
          label="Mempool"
          value={mempoolCount !== null ? fmtNum(mempoolCount) : "—"}
          sub={avgFeeRate !== null ? `${avgFeeRate} sat/vB avg` : undefined}
          loading={loading}
        />
        <MiniStat
          label="Fees sat/vB"
          value={feeStr}
          sub={feeSub}
          loading={loading}
        />
      </div>

      {/* ── Live Block Chain — fills remaining height ── */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 sm:px-5 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2.5 shrink-0 block">
          Live Chain
        </span>

        {/* Scrollable chain row */}
        <div className="flex items-start overflow-x-auto pb-1">

          {/* Pending (next) block */}
          <div className="flex items-center shrink-0">
            <PendingBlock
              nextHeight={blockHeight !== null ? blockHeight + 1 : null}
              mempoolCount={mempoolCount}
              mempoolVsize={mempoolVsize}
              avgFeeRate={avgFeeRate}
              loading={loading}
            />
            <ChainArrow />
          </div>

          {/* Confirmed blocks */}
          {loading
            ? Array.from({ length: MAX_BLOCKS }).map((_, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <div className={`${BLOCK_CARD_W} ${BLOCK_CARD_SKELETON_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
                  {i < MAX_BLOCKS - 1 && <ChainArrow faint />}
                </div>
              ))
            : blocks.map((block, i) => (
                <div key={block.id} className="flex items-center shrink-0">
                  <BlockCard
                    block={block}
                    isLatest={i === 0}
                    isNew={block.id === animatingBlockId}
                  />
                  {i < blocks.length - 1 && <ChainArrow faint />}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
