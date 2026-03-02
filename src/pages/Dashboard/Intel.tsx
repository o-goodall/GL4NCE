import { lazy, Suspense } from "react";
import GeopoliticalMarkets from "../../components/polymarket/GeopoliticalMarkets";
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

        <div className="col-span-12">
          <GeopoliticalMarkets />
        </div>

        {/* Pulse tile — placeholder for future RSS / general news feed */}
        <div className="col-span-12">
          <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pulse</h3>
              <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                General News / Context
              </p>
            </div>
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <svg
                className="w-10 h-10 text-gray-300 dark:text-gray-700 mb-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12.75 19.5v-.75a3.75 3.75 0 0 0-3.75-3.75h-1.5a1.5 1.5 0 0 1-1.5-1.5v-2.25A6.75 6.75 0 0 1 12.75 4.5h.75m0 15v-.75A3.75 3.75 0 0 1 17.25 15h1.5a1.5 1.5 0 0 0 1.5-1.5v-2.25A6.75 6.75 0 0 0 13.5 4.5h-.75M8.25 9l4.875-4.875M15.75 9l-4.875-4.875"
                />
              </svg>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                RSS news feed coming soon
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
