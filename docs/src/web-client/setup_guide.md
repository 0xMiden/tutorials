---
title: 'Web Client Setup Guide'
sidebar_position: 0
---

# Web Client Setup Guide

This guide covers the configuration required to use the Miden web SDK (`@miden-sdk/miden-sdk`) in a Next.js application. These settings apply to all web tutorials in this section.

## Prerequisites

- Node.js 20.9+ for the current Next.js template; see the `localStorage` compatibility workaround below if needed
- Next.js 14+ with App Router
- yarn or npm

## Install the SDK

```bash
yarn add @miden-sdk/miden-sdk@0.16.0
```

For React hook support:

```bash
yarn add @miden-sdk/miden-sdk@0.16.0 @miden-sdk/react@0.16.0
```

These tutorials use Next.js, so all code examples import from the SDK's `/lazy` subpath — see [Entry points: eager vs lazy](#entry-points-eager-vs-lazy) below for why that's required.

## Next.js Configuration

Create or update `next.config.ts` with these required settings. With Next.js 16 or newer, use `next dev --webpack` and `next build --webpack` so this webpack callback runs. The repository’s Next.js 15 app uses webpack by default.

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

The SDK ships two entry points:

- **Default entry** (`@miden-sdk/miden-sdk`, `@miden-sdk/react`) — awaits WASM initialization at module top level. Ergonomic for Vite and plain-browser projects: import the SDK and construct wasm-bindgen types on the next line, no ceremony. **Not usable from Next.js App Router** — top-level `await` blocks the server render phase.
- **`/lazy` subpath** (`@miden-sdk/miden-sdk/lazy`, `@miden-sdk/react/lazy`) — synchronous import with no top-level `await`. The caller is responsible for awaiting WASM readiness before constructing any wasm-bindgen type. **This is the correct entry for Next.js.**

In raw TypeScript, gate every function body on `MidenClient.ready()`:

```ts
import { MidenClient } from '@miden-sdk/miden-sdk/lazy';

export async function doSomething() {
  if (typeof window === 'undefined') return;
  await MidenClient.ready();
  // Safe to construct wasm-bindgen types from here.
  const client = await MidenClient.createTestnet();
  // …
}
```

In React, the `@miden-sdk/react/lazy` provider manages WASM readiness for you via the `isReady` flag returned by `useMiden()`. Gate any wasm-bindgen-touching code on `isReady`:

```tsx
import { useMiden, useCreateWallet } from '@miden-sdk/react/lazy';
import { getWasmOrThrow } from '@miden-sdk/miden-sdk/lazy';

function Component() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  return (
    <button
      onClick={async () =>
        createWallet({
          authScheme: (await getWasmOrThrow()).AuthScheme.AuthRpoFalcon512,
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

## Network and fee setup

The v0.16 examples use testnet by default. Run them with `yarn tutorials --web`
from the repository root; add `--web=react:createMintConsume` to select a React example.
For explicit devnet testing, run `TUTORIAL_NETWORK=devnet yarn tutorials --web`.

New accounts need the native fee asset before executing transactions. The examples
request a public P2ID note from the faucet and consume it as their first transaction,
paying that transaction's fee from the input note. User-created faucets include
`BasicWallet`, so they can receive fee funding too. The SDK supplies native
fee-conversion data automatically.

Copy `web-client/lib/feeSupport.ts` with the complete TypeScript examples and
`web-client/lib/react/tutorialSupport.tsx` with React examples. These repository
helpers fund accounts, synchronize state, and await confirmation. They select
application notes by ID or token and exclude `TX_FEE` notes (tag `0xFEE`).

The React helper's `tutorialAuthScheme()` returns the low-level Falcon enum
required by wallet and faucet hooks; it differs from the high-level client enum.

The faucet URL and funding amount default to the selected network's faucet and its advertised
`base_amount`. Override them with `NEXT_PUBLIC_MIDEN_FAUCET_URL` and
`NEXT_PUBLIC_MIDEN_FEE_AMOUNT`, or `MIDEN_FAUCET_URL` and `MIDEN_FEE_AMOUNT` in the
repository runner. `NEXT_PUBLIC_MIDEN_NETWORK` selects the network when running the app directly.

## Node.js 22+ `localStorage` polyfill

Some Node.js and Next.js combinations fail in the development overlay with:

```
TypeError: localStorage.getItem is not a function
```

The workaround below handles a server-side `localStorage` object that lacks the methods the development overlay expects. Apply it if you encounter this error; it is not a requirement for every Node.js 22+ installation.

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

This fallback supplies in-memory storage to server-side tooling. It does not persist application data and does not replace the browser's storage.

## SDK API Patterns

### Transaction return types

Transaction calls return an object containing the ID and result. In these fragments, `mintOptions` and `sendOptions` are the parameter objects built with your funded accounts and token, as shown in the mint-and-transfer tutorial:

```ts
// mint and consume return { txId, result }
const { txId: mintTxId, result: mintResult } =
  await client.transactions.mint(mintOptions);

// send returns { txId, note, result }
// note is non-null when returnNote: true
const { txId: sendTxId, note } = await client.transactions.send({
  ...sendOptions,
  returnNote: true,
});
```

### Waiting for confirmation

You can wait for a transaction to be committed in two ways:

```ts
// Option 1: Pass waitForConfirmation in the transaction call
await client.transactions.mint({
  ...mintOptions,
  waitForConfirmation: true,
});

// Option 2: Wait separately using waitFor
const { txId } = await client.transactions.mint(mintOptions);
await client.transactions.waitFor(txId); // accepts TransactionId object or hex string
```

### Using transaction IDs in URLs

When displaying transaction IDs in explorer links, call `.toHex()`:

```ts
const { txId } = await client.transactions.mint(mintOptions);
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

All mutating `MidenClient` operations (`transactions.execute`, `transactions.submit`, `sync`, account creation) and async reads are internally serialized through a single promise chain. Consumers no longer need to maintain their own JS-level mutex, and the `"recursive use of an object detected"` wasm-bindgen panic caused by the auto-sync timer racing with user operations is gone.

For the rare case where you need to coordinate a non-WASM side effect (for example, clearing an in-memory auth key on wallet lock) with whatever SDK work is currently in flight, drain the queue first:

```ts
await client.waitForIdle(); // resolves when every serialized call has settled
clearMyAuthKeys();
```
