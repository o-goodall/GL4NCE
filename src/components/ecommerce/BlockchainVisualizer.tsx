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

const BLOCKS_KEY       = "btc-blocks-v1";
const MEMPOOL_KEY      = "btc-mempool-v1";
const DIFF_KEY         = "btc-diff-adj-v1";
const FEES_KEY         = "btc-fees-v1";

const BLOCKS_TTL       = 60_000;
const MEMPOOL_TTL      = 30_000;
const DIFF_TTL         = 5 * 60_000;
const FEES_TTL         = 60_000;

const POLL_MS           = 60_000;
const MAX_BLOCKS        = 6;
const HALVING_INTERVAL  = 210_000;
const SATS_PER_BTC      = 1e8;
const FEE_SEPARATOR     = " · ";
// Block card dimensions — keep in sync with the skeleton placeholder
const BLOCK_CARD_W      = "w-[90px]";
const BLOCK_CARD_H      = "h-[76px]";

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
  label:          string;
  pct:            number | null;
  percentageLabel: string | null;
  right:          string | null;
  /** Tailwind bg-* class for the filled portion, e.g. "bg-amber-400" */
  color:          string;
  loading:        boolean;
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

function BlockCard({ block, isLatest }: { block: Block; isLatest: boolean }) {
  const reward = block.extras?.reward;
  const pool   = block.extras?.pool?.name;

  return (
    <div
      className={`flex-none w-[90px] rounded-xl border p-2 transition-colors ${
        isLatest
          ? "bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30"
          : "bg-gray-50 border-gray-100 dark:bg-white/[0.02] dark:border-gray-800"
      }`}
    >
      <div
        className={`text-[11px] font-bold tabular-nums leading-tight ${
          isLatest ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-200"
        }`}
      >
        #{fmtNum(block.height)}
      </div>
      <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1">
        {timeAgo(block.timestamp)} ago
      </div>
      <div className="space-y-0.5">
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] flex flex-col">

      {/* ── Header: title + block height + live dot ── */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
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
      <div className="px-4 pb-3 sm:px-5 space-y-2.5">
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
      <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
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

      {/* ── Recent Blocks — horizontal chain scroll ── */}
      <div className="px-4 pb-4 pt-3 sm:px-5 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2 block">
          Recent Blocks
        </span>
        <div className="flex items-center overflow-x-auto pb-0.5">
          {loading
            ? Array.from({ length: MAX_BLOCKS }).map((_, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <div className={`${BLOCK_CARD_W} ${BLOCK_CARD_H} rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse`} />
                  {i < MAX_BLOCKS - 1 && (
                    <div className="w-3 h-px bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0" />
                  )}
                </div>
              ))
            : blocks.map((block, i) => (
                <div key={block.id} className="flex items-center shrink-0">
                  <BlockCard block={block} isLatest={i === 0} />
                  {i < blocks.length - 1 && (
                    <div className="w-3 h-px bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0" />
                  )}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
