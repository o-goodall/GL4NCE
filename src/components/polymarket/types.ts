export interface MarketOutcome {
  label: string;
  /** Probability expressed as a percentage 0–100 */
  probability: number;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: MarketOutcome[];
  /** Trading volume in USD */
  volume: number;
  /** ISO-8601 date string — the market resolution date */
  endDate?: string;
  /** Deep-link to the market on Polymarket.com */
  url: string;
}

export interface PolymarketData {
  markets: PolymarketMarket[];
  lastUpdated: string;
}
