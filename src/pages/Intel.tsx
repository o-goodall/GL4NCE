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
      <div className="w-full space-y-5 pb-2">
        <div className="w-full">
          <Suspense fallback={
            <div className="h-[65vh] sm:h-[75vh] lg:h-[82vh] xl:h-[86vh] min-h-[420px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          }>
            <NewsMapWidget />
          </Suspense>
        </div>

        <div className="w-full">
          <GeopoliticalMarkets />
        </div>

        <div className="w-full">
          <Suspense fallback={
            <div className="h-[320px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          }>
            <PulseFeed />
          </Suspense>
        </div>
      </div>
    </>
  );
}
