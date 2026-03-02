import PageMeta from "../../components/common/PageMeta";

export default function Portfolio() {
  return (
    <>
      <PageMeta
        title="Portfolio | GL4NCE Dashboard"
        description="GL4NCE - Portfolio Dashboard"
      />
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Tile 1 — Coming Soon */}
        <div className="col-span-12 sm:col-span-6 xl:col-span-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                1
              </span>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[100px]">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Tile 2 — Coming Soon */}
        <div className="col-span-12 sm:col-span-6 xl:col-span-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                2
              </span>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[100px]">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Tile 4 — Coming Soon (tile 3 Monthly Sales removed per requirements) */}
        <div className="col-span-12 xl:col-span-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                4
              </span>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
              </h3>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[100px]">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Tile 5 — Coming Soon */}
        <div className="col-span-12">
          <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                5
              </span>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
              </h3>
            </div>
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-400 dark:text-gray-500 text-sm">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Tile 6 — Coming Soon */}
        <div className="col-span-12">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-8 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                6
              </span>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                Coming Soon
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
