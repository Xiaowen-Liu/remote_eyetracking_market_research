import { defineConfig } from "vite";

export default defineConfig(() => {
  const cameraRuntime = process.env.WEBGAZE_CAMERA_RUNTIME === "1";
  return {
    build: {
      lib: {
        entry: cameraRuntime ? "collector-extension/src/camera.ts" : "collector-extension/src/content.ts",
        formats: ["iife"],
        name: cameraRuntime ? "WebGazeCamera" : "WebGazeCollector",
        fileName: () => cameraRuntime ? "camera.js" : "content.js",
      },
      outDir: "collector-extension/dist",
      emptyOutDir: !cameraRuntime,
      rollupOptions: { output: { assetFileNames: "[name][extname]" } },
    },
  };
});
