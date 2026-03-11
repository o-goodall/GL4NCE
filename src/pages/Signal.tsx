import MoneyPrinter from "../components/ecommerce/MoneyPrinter";
import BtcLiveChart from "../components/ecommerce/BtcLiveChart";
import MonthlyTarget from "../components/ecommerce/MonthlyTarget";
import BlockchainVisualizer from "../components/ecommerce/BlockchainVisualizer";
import PageMeta from "../components/common/PageMeta";

export default function Signal() {
  return (
    <>
      <PageMeta
        title="GL4NCE Dashboard"
        description="GL4NCE - Bitcoin DCA Signal Dashboard"
      />
      <div className="w-full space-y-5 pb-2">
        <div className="w-full">
          <BtcLiveChart />
        </div>

        <div className="w-full">
          <MonthlyTarget />
        </div>

        <div className="w-full">
          <BlockchainVisualizer />
        </div>

        <div className="w-full">
          <MoneyPrinter />
        </div>
      </div>
    </>
  );
}
