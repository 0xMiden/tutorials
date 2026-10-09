import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The v0.17 wallet adapters publish an ESM `module` entry without `main`.
    mainFields: ["module", "main"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: true,
    server: {
      deps: {
        // Tests mock the wallet adapter at the module level, so externalizing is safe.
        external: [/@miden-sdk\/miden-wallet-adapter-react/],
      },
    },
  },
});
