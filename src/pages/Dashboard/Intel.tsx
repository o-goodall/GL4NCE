import { lazy, Suspense } from "react";
import EcommerceMetrics from "../../components/ecommerce/EcommerceMetrics";
import MonthlySalesChart from "../../components/ecommerce/MonthlySalesChart";
import StatisticsChart from "../../components/ecommerce/StatisticsChart";
import MonthlyTarget from "../../components/ecommerce/MonthlyTarget";
import RecentOrders from "../../components/ecommerce/RecentOrders";
import PageMeta from "../../components/common/PageMeta";

const NewsMapWidget = lazy(() => import("../../components/news-map/NewsMapWidget"));

export default function Intel() {
  return (
    <>
      <PageMeta
        title="Intel | GL4NCE Dashboard"
        description="GL4NCE - Intel Dashboard"
      />
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12">
          <Suspense fallback={
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
              <div className="h-[420px] sm:h-[520px] xl:h-[620px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
            </div>
          }>
            <NewsMapWidget />
          </Suspense>
        </div>

        <div className="col-span-12 space-y-6 xl:col-span-7">
          <EcommerceMetrics />

          <MonthlySalesChart />
        </div>

        <div className="col-span-12 xl:col-span-5">
          <MonthlyTarget />
        </div>

        <div className="col-span-12">
          <StatisticsChart />
        </div>

        <div className="col-span-12">
          <RecentOrders />
        </div>
      </div>
    </>
  );
}
