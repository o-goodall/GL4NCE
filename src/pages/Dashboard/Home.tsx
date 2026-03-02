import EcommerceMetrics from "../../components/ecommerce/EcommerceMetrics";
import BtcLiveChart from "../../components/ecommerce/BtcLiveChart";
import MonthlyTarget from "../../components/ecommerce/MonthlyTarget";
import RecentOrders from "../../components/ecommerce/RecentOrders";
import PageMeta from "../../components/common/PageMeta";

export default function Home() {
  return (
    <>
      <PageMeta
        title="GL4NCE Dashboard"
        description="GL4NCE - Bitcoin DCA Signal Dashboard"
      />
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12 space-y-6 xl:col-span-7">
          <EcommerceMetrics />
        </div>

        <div className="col-span-12 xl:col-span-5">
          <MonthlyTarget />
        </div>

        <div className="col-span-12">
          <BtcLiveChart />
        </div>

        <div className="col-span-12">
          <RecentOrders />
        </div>
      </div>
    </>
  );
}
