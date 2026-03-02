import BitcoinTicker from "./BitcoinTicker";
import MoneyPrinter from "./MoneyPrinter";
import BtcGoldRatio from "./BtcGoldRatio";

export default function EcommerceMetrics() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">
      {/* <!-- Tile 1: Bitcoin Live Chart (full width) --> */}
      <div className="sm:col-span-2">
        <BitcoinTicker />
      </div>

      {/* <!-- Tile 2: Money Printer (Central Bank QE Monitor) --> */}
      <MoneyPrinter />

      {/* <!-- Tile 3: BTC/Gold Hard Money Ratio --> */}
      <div className="sm:col-span-2">
        <BtcGoldRatio />
      </div>
    </div>
  );
}
