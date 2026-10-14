import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Self-contained single-screen build: no CDN, no dynamic imports, no network fonts.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", assetsInlineLimit: 0, modulePreload: false },
});
