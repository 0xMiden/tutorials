import type { NextConfig } from "next";

// Polyfill `localStorage` in the Node SSR context used by `next dev`.
//
// Starting with Node 22, `globalThis.localStorage` exists but its methods
// (getItem, setItem, …) are undefined unless Node is started with
// `--localstorage-file`. Next.js's dev overlay guards with
// `typeof localStorage !== 'undefined'` — which succeeds on Node 22+ since
// the object is defined — and then calls `localStorage.getItem(...)`, which
// throws `TypeError: localStorage.getItem is not a function` on every page
// request. Without this polyfill the Playwright suite cannot verify the
// tutorials on Node 22+.
//
// The polyfill is harmless on Node ≤21: this module assigns the in-memory
// stub to `globalThis.localStorage` unconditionally, but on Node ≤21 the dev
// overlay's `typeof localStorage !== 'undefined'` guard previously short-
// circuited because `localStorage` was undefined — after assignment here it
// simply uses the stub, which matches the semantics the overlay expects.
// It has no effect on `next build` / static export (no SSR). The polyfill is
// unrelated to the SDK and only exists to keep `next dev` usable on modern
// Node.
{
  const store = new Map<string, string>();
  const poly = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
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
