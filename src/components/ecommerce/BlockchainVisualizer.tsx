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

const BLOCKS_KEY  = "btc-blocks-v1";
const MEMPOOL_KEY = "btc-mempool-v1";
const DIFF_KEY    = "btc-diff-adj-v1";
const FEES_KEY    = "btc-fees-v1";

const BLOCKS_TTL  = 60_000;
const MEMPOOL_TTL = 30_000;
const DIFF_TTL    = 5 * 60_000;
const FEES_TTL    = 60_000;

const POLL_MS         = 60_000;
const MAX_BLOCKS      = 8;
const BLOCKS_PER_EPOCH = 2016;
const SATS_PER_BTC    = 1e8;

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

interface StatCardProps {
  label:    string;
  value:    string;
  sub?:     string;
  color?:   string;
  loading?: boolean;
}

function StatCard({ label, value, sub, color = "text-gray-800 dark:text-white/90", loading = false }: StatCardProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">
        {label}
      </span>
      {loading ? (
        <div className="h-5 w-16 mt-0.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ) : (
        <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      )}
      {sub && !loading && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{sub}</span>
      )}
    </div>
  );
}

function BlockCard({ block, isLatest }: { block: Block; isLatest: boolean }) {
  const reward = block.extras?.reward;
  const pool   = block.extras?.pool?.name;

  return (
    <div
      className={`flex-none w-[108px] rounded-xl border p-2.5 transition-colors ${
        isLatest
          ? "bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30"
          : "bg-gray-50 border-gray-100 dark:bg-white/[0.02] dark:border-gray-800"
      }`}
    >
      <div
        className={`text-[11px] font-bold tabular-nums ${
          isLatest ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-200"
        }`}
      >
        #{fmtNum(block.height)}
      </div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
        {timeAgo(block.timestamp)} ago
      </div>
      <div className="space-y-0.5">
        <div className="text-[10px] tabular-nums text-gray-600 dark:text-gray-300">
          {fmtNum(block.tx_count)} txs
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">
          {fmtBytes(block.size)}
        </div>
        {reward != null && (
          <div className="text-[10px] tabular-nums text-amber-500 dark:text-amber-400">
            {fmtReward(reward)}
          </div>
        )}
        {pool && (
          <div className="text-[9px] text-gray-400 dark:text-gray-500 truncate" title={pool}>
            {pool}
          </div>
        )}
      </div>
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

  // ── Derived values ────────────────────────────────────────────────────────
  const blockHeight     = blocks[0]?.height ?? null;
  const epochProgress   = difficulty?.progressPercent ?? null;
  const estDiffChange   = difficulty?.difficultyChange ?? null;
  const lastDiffChange  = difficulty?.previousRetarget ?? null;
  const remainingBlocks = difficulty?.remainingBlocks ?? null;
  const blocksInEpoch   =
    remainingBlocks !== null && epochProgress !== null
      ? Math.round((epochProgress / 100) * BLOCKS_PER_EPOCH)
      : null;

  const mempoolCount = mempool?.count ?? null;
  const mempoolVsize = mempool?.vsize ?? null;
  const avgFeeRate   =
    mempoolVsize && mempool?.total_fee
      ? Math.round(mempool.total_fee / mempoolVsize)
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 sm:px-6 sm:pt-6 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            3
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Blockchain</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Live</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-5 pb-5 pt-4 sm:px-6 gap-4 min-h-0">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <StatCard
            label="Block Height"
            value={blockHeight !== null ? `#${fmtNum(blockHeight)}` : "—"}
            loading={loading}
          />
          <StatCard
            label="Epoch Progress"
            value={epochProgress !== null ? `${epochProgress.toFixed(1)}%` : "—"}
            sub={remainingBlocks !== null ? `${fmtNum(remainingBlocks)} left` : undefined}
            loading={loading}
          />
          <StatCard
            label="Est. Diff Adj"
            value={estDiffChange !== null ? fmtPct(estDiffChange) : "—"}
            color={pctColor(estDiffChange)}
            loading={loading}
          />
          <StatCard
            label="Last Diff Adj"
            value={lastDiffChange !== null ? fmtPct(lastDiffChange) : "—"}
            color={pctColor(lastDiffChange)}
            loading={loading}
          />
        </div>

        {/* Epoch progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">
              Epoch
            </span>
            {loading ? (
              <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ) : blocksInEpoch !== null && remainingBlocks !== null ? (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                {fmtNum(blocksInEpoch)} / {fmtNum(BLOCKS_PER_EPOCH)} blocks
              </span>
            ) : null}
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            {loading ? (
              <div className="h-full w-1/3 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ) : epochProgress !== null ? (
              <div
                className="h-full rounded-full bg-orange-400 transition-all duration-700"
                style={{ width: `${Math.min(100, epochProgress)}%` }}
              />
            ) : null}
          </div>
        </div>

        {/* Mempool + Fees */}
        <div className="grid grid-cols-2 gap-3">
          {/* Mempool */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] p-3">
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2.5 block">
              Mempool
            </span>
            {loading ? (
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Unconfirmed</span>
                  <span className="text-xs font-semibold tabular-nums text-gray-800 dark:text-white/80">
                    {mempoolCount !== null ? fmtNum(mempoolCount) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Size</span>
                  <span className="text-xs font-semibold tabular-nums text-gray-800 dark:text-white/80">
                    {mempoolVsize !== null ? fmtBytes(mempoolVsize) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Avg fee</span>
                  <span className="text-xs font-semibold tabular-nums text-gray-800 dark:text-white/80">
                    {avgFeeRate !== null ? `${avgFeeRate} sat/vB` : "—"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Fee Estimator */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] p-3">
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2.5 block">
              Fee Estimator
            </span>
            {loading ? (
              <div className="space-y-2">
                <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Fast (~10 min)</span>
                  <span className="text-xs font-semibold tabular-nums text-red-500 dark:text-red-400">
                    {fees?.fastestFee != null ? `${fees.fastestFee} sat/vB` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Mid (~30 min)</span>
                  <span className="text-xs font-semibold tabular-nums text-yellow-500 dark:text-yellow-400">
                    {fees?.halfHourFee != null ? `${fees.halfHourFee} sat/vB` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Slow (~1 hr)</span>
                  <span className="text-xs font-semibold tabular-nums text-emerald-500 dark:text-emerald-400">
                    {fees?.hourFee != null ? `${fees.hourFee} sat/vB` : "—"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Blocks */}
        <div className="flex-1 min-h-0 flex flex-col">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2 shrink-0">
            Recent Blocks
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1 items-start">
            {loading
              ? Array.from({ length: MAX_BLOCKS }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-none w-[108px] h-[90px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse"
                  />
                ))
              : blocks.map((block, i) => (
                  <BlockCard key={block.id} block={block} isLatest={i === 0} />
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}
