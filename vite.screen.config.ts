import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One self-contained IIFE for the app-screens/v2 frame. The host wraps the
// bytes in its own document (no import, chunk, CDN or font); the entry mounts
// into the frame's #root on load. Output: dist/screen/client.js + styles.css.
export default defineConfig({
  plugins: [react()],
  // Lib mode does not set NODE_ENV; without this React ships its development
  // runtime, which carries the react.dev/link/special-props URL the packager refuses.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist/screen",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    lib: {
      entry: "src/main.tsx",
      name: "DesignerStudioScreen",
      formats: ["iife"],
      fileName: () => "client.js",
      cssFileName: "styles",
    },
  },
});
