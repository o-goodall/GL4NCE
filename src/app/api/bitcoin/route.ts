import { NextResponse } from 'next/server';

const NEXT_HALVING_BLOCK = 1_050_000;
const PREV_HALVING_BLOCK = 840_000;
const AVG_BLOCK_TIME_MINUTES = 10;

export async function GET() {
  try {
    const [priceRes, feesRes, blockRes, latestBlockRes, mempoolRes] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
      fetch('https://mempool.space/api/v1/fees/recommended'),
      fetch('https://mempool.space/api/blocks/tip/height'),
      fetch('https://mempool.space/api/v1/blocks'),
      fetch('https://mempool.space/api/mempool'),
    ]);

    let price = 0;
    if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
      const d = await priceRes.value.json();
      price = d?.bitcoin?.usd ?? 0;
    }
    if (price === 0) {
      const fb = await fetch('https://mempool.space/api/v1/prices').catch(() => null);
      if (fb?.ok) { const d = await fb.json(); price = d?.USD ?? 0; }
    }

    let fees = { fastestFee: 1, halfHourFee: 1, hourFee: 1 };
    if (feesRes.status === 'fulfilled' && feesRes.value.ok) fees = await feesRes.value.json();

    let blockHeight = 0;
    if (blockRes.status === 'fulfilled' && blockRes.value.ok) blockHeight = await blockRes.value.json();

    let latestBlock = null;
    if (latestBlockRes.status === 'fulfilled' && latestBlockRes.value.ok) {
      const blocks = await latestBlockRes.value.json();
      if (Array.isArray(blocks) && blocks.length > 0) {
        const b = blocks[0];
        latestBlock = { height: b.height, timestamp: b.timestamp, size: b.size, txCount: b.tx_count, miner: b.extras?.pool?.name ?? 'Unknown', weight: b.weight, medianFee: b.extras?.medianFee ?? null, totalFees: b.extras?.totalFees ?? null, reward: b.extras?.reward ?? null };
      }
    }

    let mempool = null;
    if (mempoolRes.status === 'fulfilled' && mempoolRes.value.ok) {
      const m = await mempoolRes.value.json();
      mempool = { count: m.count ?? 0, vsize: m.vsize ?? 0, totalFee: m.total_fee ?? 0 };
    }

    const blocksToHalving = Math.max(0, NEXT_HALVING_BLOCK - blockHeight);
    const minutesToHalving = blocksToHalving * AVG_BLOCK_TIME_MINUTES;
    const msToHalving = minutesToHalving * 60 * 1000;
    const estimatedHalvingDate = new Date(Date.now() + msToHalving).toISOString().split('T')[0];
    const halvingProgressPct = Math.min(100, ((blockHeight - PREV_HALVING_BLOCK) / (NEXT_HALVING_BLOCK - PREV_HALVING_BLOCK)) * 100);
    const daysToHalving = Math.ceil(minutesToHalving / 1440);

    return NextResponse.json({
      price, satsPerDollar: price > 0 ? Math.round(1e8 / price) : 0, blockHeight,
      fees: { low: fees.hourFee, medium: fees.halfHourFee, high: fees.fastestFee },
      latestBlock, mempool,
      halving: { blocksRemaining: blocksToHalving, daysRemaining: daysToHalving, estimatedDate: estimatedHalvingDate, progressPct: parseFloat(halvingProgressPct.toFixed(2)), nextHalvingBlock: NEXT_HALVING_BLOCK, currentReward: 3.125, nextReward: 1.5625, epoch: 5 },
    });
  } catch {
    return NextResponse.json({ price: 0, satsPerDollar: 0, blockHeight: 0, fees: { low: 0, medium: 0, high: 0 }, latestBlock: null, mempool: null, halving: null });
  }
}
