import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const GF_BASE = 'https://ghostfol.io';

async function getBearerToken(securityToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GF_BASE}/api/v1/auth/anonymous`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: securityToken }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.authToken ?? null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const securityToken = request.nextUrl.searchParams.get('token');
  if (!securityToken) return NextResponse.json({ error: 'No token' }, { status: 400 });

  const bearer = await getBearerToken(securityToken);
  if (!bearer) return NextResponse.json({ error: 'Auth failed — check your security token' }, { status: 401 });

  const headers = { Authorization: `Bearer ${bearer}` };
  const [perfMaxRes, perfYtdRes, perf1dRes, holdingsRes] = await Promise.allSettled([
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=max`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=ytd`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=1d`, { headers }),
    fetch(`${GF_BASE}/api/v1/portfolio/holdings`, { headers }),
  ]);

  let netWorth: number | null = null, totalInvested: number | null = null, netGainPct: number | null = null, netGainYtdPct: number | null = null, todayChangePct: number | null = null;

  if (perfMaxRes.status === 'fulfilled' && perfMaxRes.value.ok) {
    const d = await perfMaxRes.value.json();
    const p = d?.performance ?? d;
    netWorth = p?.currentNetWorth ?? p?.currentValueInBaseCurrency ?? null;
    totalInvested = p?.totalInvestment ?? null;
    netGainPct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (netGainPct !== null && Math.abs(netGainPct) < 1 && netGainPct !== 0) netGainPct = netGainPct * 100;
  }
  if (perfYtdRes.status === 'fulfilled' && perfYtdRes.value.ok) {
    const d = await perfYtdRes.value.json();
    const p = d?.performance ?? d;
    netGainYtdPct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (netGainYtdPct !== null && Math.abs(netGainYtdPct) < 1 && netGainYtdPct !== 0) netGainYtdPct = netGainYtdPct * 100;
  }
  if (perf1dRes.status === 'fulfilled' && perf1dRes.value.ok) {
    const d = await perf1dRes.value.json();
    const p = d?.performance ?? d;
    todayChangePct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (todayChangePct !== null && Math.abs(todayChangePct) < 1 && todayChangePct !== 0) todayChangePct = todayChangePct * 100;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let holdings: { symbol: string; name: string; allocationInPercentage: number; valueInBaseCurrency: number; netPerformancePercentWithCurrencyEffect: number; assetClass: string }[] = [];
  if (holdingsRes.status === 'fulfilled' && holdingsRes.value.ok) {
    const d = await holdingsRes.value.json();
    const raw = d?.holdings ?? d;
    if (raw && typeof raw === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      holdings = Object.values(raw).map((h: any) => ({
        symbol: h.symbol ?? '', name: h.name ?? h.symbol ?? '',
        allocationInPercentage: (h.allocationInPercentage ?? 0) * 100,
        valueInBaseCurrency: h.valueInBaseCurrency ?? 0,
        netPerformancePercentWithCurrencyEffect: (h.netPerformancePercentWithCurrencyEffect ?? h.netPerformancePercent ?? 0) * 100,
        assetClass: h.assetClass ?? '',
      })).filter((h) => h.symbol && h.valueInBaseCurrency > 0).sort((a, b) => b.valueInBaseCurrency - a.valueInBaseCurrency).slice(0, 8);
    }
  }

  return NextResponse.json({ netWorth, totalInvested, netGainPct, netGainYtdPct, todayChangePct, holdings });
}
