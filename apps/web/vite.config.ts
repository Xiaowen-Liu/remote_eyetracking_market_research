import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    setupFiles: "./src/vitest.setup.ts",
  },
});
