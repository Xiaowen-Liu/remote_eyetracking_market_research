import { defineConfig } from "vite";

export default defineConfig({
  build: { lib: { entry: "collector-extension/src/content.ts", formats: ["iife"], name: "WebGazeCollector", fileName: () => "content.js" }, outDir: "collector-extension/dist", emptyOutDir: true, rollupOptions: { output: { assetFileNames: "[name][extname]" } } },
});
