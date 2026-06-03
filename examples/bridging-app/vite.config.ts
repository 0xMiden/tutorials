import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

// Do not set COOP/COEP on the dev document. Cross-origin isolation can make
// fetches to the Miden note transport (`https://transport.miden.io`,
// gRPC-Web) appear without a readable `Content-Type`, which surfaces as:
// MissingContentTypeHeader / "failed to sync state". `midenVitePlugin`
// defaults to `crossOriginIsolation: true` and sets COOP/COEP headers —
// we explicitly pass `false` to opt out.
// Opt back in only if you need crossOriginIsolation for something else
// (e.g. threaded WASM):
//   server: {
//     headers: {
//       'Cross-Origin-Opener-Policy': 'same-origin',
//       'Cross-Origin-Embedder-Policy': 'credentialless',
//     },
//   }
export default defineConfig({
  plugins: [
    react(),
    midenVitePlugin({ crossOriginIsolation: false }),
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
    format: "es",
  },
});
