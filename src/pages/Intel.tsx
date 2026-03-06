import { lazy, Suspense } from "react";
import GeopoliticalMarkets from "../components/polymarket/GeopoliticalMarkets";
import PageMeta from "../components/common/PageMeta";

const NewsMapWidget = lazy(() => import("../components/news-map/NewsMapWidget"));
const PulseFeed = lazy(() => import("../components/pulse/PulseFeed"));

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

        <div className="col-span-12">
          <GeopoliticalMarkets />
        </div>

        {/* Pulse tile — RSS general news feed with category groups */}
        <div className="col-span-12">
          <Suspense fallback={
            <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
              <div className="h-[320px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
            </div>
          }>
            <PulseFeed />
          </Suspense>
        </div>
      </div>
    </>
  );
}
