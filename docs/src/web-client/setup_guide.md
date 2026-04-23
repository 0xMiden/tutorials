---
title: 'Web Client Setup Guide'
sidebar_position: 0
---

# Web Client Setup Guide

This guide covers the configuration required to use the Miden web SDK (`@miden-sdk/miden-sdk`) in a Next.js application. These settings apply to all web tutorials in this section.

## Prerequisites

- Node.js 20+ (Node 22+ requires an extra `localStorage` polyfill — see below)
- Next.js 14+ with App Router
- yarn or npm

## Install the SDK

```bash
yarn add @miden-sdk/miden-sdk
```

For React hook support:

```bash
yarn add @miden-sdk/react
```

These tutorials use Next.js, so all code examples import from the SDK's `/lazy` subpath — see [Entry points: eager vs lazy](#entry-points-eager-vs-lazy) below for why that's required.

## Next.js Configuration

Create or update `next.config.ts` with these required settings:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export avoids runtime SSR entirely.
  // The SDK is browser-only, so static export is recommended.
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  experimental: {
    // Required for the SDK's ESM bundle to resolve correctly in webpack.
    esmExternals: 'loose',
  },
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      // Required: the SDK loads a WASM binary for Miden VM operations.
      asyncWebAssembly: true,
      topLevelAwait: true,
    };

    // Serve .wasm files as static assets.
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
};

export default nextConfig;
```

### Importing `.masm` files (for smart contract tutorials)

If your tutorials use Miden assembly (`.masm`) files, add this webpack rule inside the `webpack` callback:

```ts
// Import .masm files as plain text strings.
config.module.rules.push({
  test: /\.masm$/,
  type: 'asset/source',
});
```

Then create `lib/masm/masm.d.ts` so TypeScript recognizes the imports:

```ts
declare module '*.masm' {
  const content: string;
  export default content;
}
```

:::tip Other bundlers

- **Vite:** use the `?raw` suffix — `import code from './masm/counter_contract.masm?raw'`
- **No bundler:** use `fetch()` at runtime — `const code = await fetch('/masm/counter_contract.masm').then(r => r.text())`

:::

## Entry points: eager vs lazy

Starting with `@miden-sdk/miden-sdk@0.14.4`, the SDK ships two entry points:

- **Default entry** (`@miden-sdk/miden-sdk`, `@miden-sdk/react`) — awaits WASM initialization at module top level. Ergonomic for Vite and plain-browser projects: import the SDK and construct wasm-bindgen types on the next line, no ceremony. **Not usable from Next.js App Router** — top-level `await` blocks the server render phase.
- **`/lazy` subpath** (`@miden-sdk/miden-sdk/lazy`, `@miden-sdk/react/lazy`) — synchronous import with no top-level `await`. The caller is responsible for awaiting WASM readiness before constructing any wasm-bindgen type. **This is the correct entry for Next.js.**

In raw TypeScript, gate every function body on `MidenClient.ready()`:

```ts
import { MidenClient } from '@miden-sdk/miden-sdk/lazy';

export async function doSomething() {
  if (typeof window === 'undefined') return;
  await MidenClient.ready();
  // Safe to construct wasm-bindgen types from here.
  const client = await MidenClient.create({
    rpcUrl: 'https://rpc.testnet.miden.io',
  });
  // …
}
```

In React, the `@miden-sdk/react/lazy` provider manages WASM readiness for you via the `isReady` flag returned by `useMiden()`. Gate any wasm-bindgen-touching code on `isReady`:

```tsx
import { useMiden, useCreateWallet } from '@miden-sdk/react/lazy';

function Component() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  return (
    <button
      onClick={() =>
        createWallet({
          /* … */
        })
      }
      disabled={!isReady}
    >
      {isReady ? 'Create wallet' : 'Initializing…'}
    </button>
  );
}
```

:::warning Types imported from `/lazy` are stubs until `ready()` resolves

Never construct wasm-bindgen types (`AccountId`, `Note`, `createP2IDNote`, `TransactionRequestBuilder`, etc.) at module top level or in a render-body `useMemo` — always inside an effect, event handler, or async hook callback where WASM is already initialized. For display-only cases like shortening an address, slice the bech32 string directly (`addr.slice(0, 8) + '…' + addr.slice(-4)`); don't parse it with `AccountId.fromBech32()` just to get a prefix.

:::

## Node.js 22+ `localStorage` polyfill

If you run `next dev` under Node.js 22 or later, every page request will crash with:

```
TypeError: localStorage.getItem is not a function
```

This is a Node + Next.js interaction, not a Miden SDK issue. Node 22+ defines `globalThis.localStorage` as an object, but its methods (`getItem`, `setItem`, …) are undefined unless Node is launched with `--localstorage-file`. Next.js's dev overlay guards with `typeof localStorage !== 'undefined'`, which passes on Node 22+, and then calls the missing methods.

Add this polyfill at the top of `next.config.ts`, before the config object:

```ts
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
```

This only affects `next dev` (SSR); static exports via `next build` are unaffected. The polyfill is harmless on Node ≤21 — it installs an in-memory stub that the dev overlay uses just like Node 22+'s (broken) built-in.

## SDK API Patterns

### Transaction return types

All transaction methods return an object, not a plain transaction ID:

```ts
// mint and consume return { txId, result }
const { txId } = await client.transactions.mint({ ... });

// send returns { txId, note, result }
// note is non-null when returnNote: true
const { txId, note } = await client.transactions.send({
  ...,
  returnNote: true,
});
```

### Waiting for confirmation

You can wait for a transaction to be committed in two ways:

```ts
// Option 1: Pass waitForConfirmation in the transaction call
await client.transactions.mint({
  ...,
  waitForConfirmation: true,
});

// Option 2: Wait separately using waitFor
const { txId } = await client.transactions.mint({ ... });
await client.transactions.waitFor(txId); // accepts TransactionId object or hex string
```

### Using transaction IDs in URLs

When displaying transaction IDs in explorer links, call `.toHex()`:

```ts
const { txId } = await client.transactions.mint({ ... });
console.log(`https://testnet.midenscan.com/tx/${txId.toHex()}`);
```

### Authentication

Create an authentication key using `AuthSecretKey` (inside an async function, after awaiting `MidenClient.ready()` so the wasm-bindgen constructor is live):

```ts
import { MidenClient, AuthSecretKey } from '@miden-sdk/miden-sdk/lazy';

export async function createAuth() {
  await MidenClient.ready();

  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const auth = AuthSecretKey.rpoFalconWithRNG(seed);
  return { seed, auth };
}
```

Pass `auth` and `seed` when creating contract accounts that require authentication.

### Concurrency safety and `waitForIdle()`

As of `@miden-sdk/miden-sdk@0.14.4`, all mutating `WebClient` methods (`transactions.execute`, `transactions.submit`, `syncState`, account creation) and async proxy-fallback reads (`getAccount`, `importAccountById`, `getAccountStorage`, etc.) are internally serialized through a single promise chain. Consumers no longer need to maintain their own JS-level mutex, and the `"recursive use of an object detected"` wasm-bindgen panic caused by the 15-second auto-sync timer racing with user operations is gone.

For the rare case where you need to coordinate a non-WASM side effect (for example, clearing an in-memory auth key on wallet lock) with whatever SDK work is currently in flight, drain the queue first:

```ts
await client.waitForIdle(); // resolves when every serialized call has settled
clearMyAuthKeys();
```
