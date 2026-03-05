import MoneyPrinter from "../../components/ecommerce/MoneyPrinter";
import BtcLiveChart from "../../components/ecommerce/BtcLiveChart";
import MonthlyTarget from "../../components/ecommerce/MonthlyTarget";
import BlockchainVisualizer from "../../components/ecommerce/BlockchainVisualizer";
import PageMeta from "../../components/common/PageMeta";

export default function Home() {
  return (
    <>
      <PageMeta
        title="GL4NCE Dashboard"
        description="GL4NCE - Bitcoin DCA Signal Dashboard"
      />
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Row 1: Tile 1 (₿ Bitcoin Live Chart) + Tile 4 (DCA Signal) — inline */}
        <div className="col-span-12 xl:col-span-7">
          <BtcLiveChart />
        </div>

        <div className="col-span-12 xl:col-span-5">
          <MonthlyTarget />
        </div>

        {/* Row 2: Tile 3 (Blockchain Visualizer) + Tile 6 (Money Printer) — inline */}
        <div className="col-span-12 xl:col-span-7">
          <BlockchainVisualizer />
        </div>

        <div className="col-span-12 xl:col-span-5">
          <MoneyPrinter />
        </div>

        {/* Tile 2: Coming Soon (content moved to tile 6) */}
        <div className="col-span-12">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
              </h3>
            </div>
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Tile 7: Coming Soon (placeholder) */}
        <div className="col-span-12">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
                Recent Orders
              </h3>
            </div>
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
