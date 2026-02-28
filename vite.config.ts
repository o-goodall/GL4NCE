import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        // This will transform your SVG to a React component
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  build: {
    // apexcharts is ~576 kB minified — acknowledge it as a known large vendor
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Bundle apexcharts into a stable, cacheable vendor chunk
          "vendor-apexcharts": ["apexcharts", "react-apexcharts"],
        },
      },
    },
  },
});
