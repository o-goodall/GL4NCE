import BitcoinTicker from "./BitcoinTicker";
import MoneyPrinter from "./MoneyPrinter";

export default function EcommerceMetrics() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">
      {/* <!-- Tile 1: Bitcoin Ticker --> */}
      <BitcoinTicker />

      {/* <!-- Tile 2: Money Printer (Central Bank QE Monitor) --> */}
      <MoneyPrinter />
    </div>
  );
}
