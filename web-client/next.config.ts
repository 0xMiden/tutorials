import type { NextConfig } from "next";

// Polyfill localStorage for the Node.js SSR context in `next dev`.
// Node 22+ defines a localStorage object on globalThis, but without the
// --localstorage-file flag its methods (getItem, setItem, etc.) do not exist.
// Next.js's DevOverlay uses `typeof localStorage !== 'undefined'` as a guard,
// which passes on Node 22+ since the object exists — then crashes calling the
// missing getItem. This polyfill provides a working in-memory implementation.
// Static export (`next build`) is unaffected — only `next dev` (SSR) hits this.

{
  const store = new Map<string, string>();
  const poly = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  (globalThis as Record<string, unknown>).localStorage = poly;
}

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  experimental: {
    esmExternals: "loose",
  },
  webpack: (config, { isServer }) => {
    // Handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
    };

    // Add WASM to asset rules
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    // Import .masm files as strings
    config.module.rules.push({
      test: /\.masm$/,
      type: "asset/source",
    });

    return config;
  },
};

export default nextConfig;
