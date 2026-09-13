---
title: 'Incrementing the Count of the Counter Contract'
sidebar_position: 5
---

_Using the Miden client to interact with a custom smart contract_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.

:::

## Overview

In this tutorial, we will deploy a custom counter smart contract and increment its count using the Miden client. Each run creates a fresh counter account, deploys it to the network, and immediately calls its `increment_count` procedure via a transaction script — so the final count is always `1`.

This tutorial provides a foundational understanding of building and interacting with custom smart contracts on Miden.

## What we'll cover

- Deploying a custom smart contract on Miden from a web client
- Calling procedures in an account from a transaction script

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

This tutorial assumes you have a basic understanding of Miden assembly. To quickly get up to speed with Miden assembly (MASM), please play around with running basic Miden assembly programs in the [Miden playground](https://0xmiden.github.io/examples/).

## Step 1: Initialize your Next.js project

1. Create a new Next.js app with TypeScript:

   ```bash
   npx create-next-app@latest miden-web-app --typescript
   ```

   Hit enter for all terminal prompts.

2. Change into the project directory:

   ```bash
   cd miden-web-app
   ```

3. Install the Miden SDK:
   ```bash
   yarn add @miden-sdk/miden-sdk@0.16.0
   ```

The current Next.js template uses Turbopack by default. These examples use the webpack configuration from the setup guide, so update both scripts in `package.json`:

`package.json`

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
```

## Step 2: Edit the `app/page.tsx` file:

Add the following code to the `app/page.tsx` file. This code defines the main page of our web application:

```tsx
'use client';
import { useState } from 'react';
import { incrementCounterContract } from '../lib/incrementCounterContract';

export default function Home() {
  const [isIncrementCounter, setIsIncrementCounter] = useState(false);

  const handleIncrementCounterContract = async () => {
    setIsIncrementCounter(true);
    await incrementCounterContract();
    setIsIncrementCounter(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black text-slate-800 dark:text-slate-100">
      <div className="text-center">
        <h1 className="text-4xl font-semibold mb-4">Miden Web App</h1>
        <p className="mb-6">
          Open your browser console to see Miden client logs.
        </p>

        <div className="max-w-sm w-full bg-gray-800/20 border border-gray-600 rounded-2xl p-6 mx-auto flex flex-col gap-4">
          <button
            onClick={handleIncrementCounterContract}
            className="w-full px-6 py-3 text-lg cursor-pointer bg-transparent border-2 border-orange-600 text-white rounded-lg transition-all hover:bg-orange-600 hover:text-white"
          >
            {isIncrementCounter
              ? 'Working...'
              : 'Tutorial #3: Increment Counter Contract'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

## Step 3: Write the MASM Counter Contract

The counter contract code lives in a separate `.masm` file. Create a `lib/masm/` directory and add the contract file:

```bash
mkdir -p lib/masm
```

Create the file `lib/masm/counter_contract.masm` with the following Miden Assembly code:

```masm
use miden::protocol::active_account
use miden::protocol::native_account
use miden::core::sys

# CONSTANTS
# =================================================================================================

const COUNTER_SLOT = word("miden::tutorials::counter")

# PUBLIC INTERFACE
# =================================================================================================

#! Returns the current count.
#!
#! Inputs:  [pad(16)]
#! Outputs: [count, pad(15)]
#!
#! Invocation: call
@account_procedure
pub proc get_count() -> felt
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [[count, 0, 0, 0], pad(16)]

    exec.sys::truncate_stack
    # => [count, pad(15)]
end

#! Increments the current count by one.
#!
#! Inputs:  [pad(16)]
#! Outputs: [pad(16)]
#!
#! Invocation: call
@account_procedure
pub proc increment_count()
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [[count, 0, 0, 0], pad(16)]

    add.1
    # => [[count + 1, 0, 0, 0], pad(16)]

    push.COUNTER_SLOT[0..2] exec.native_account::set_item
    # => [OLD_VALUE, pad(16)]

    dropw
    # => [pad(16)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

Also create `lib/masm/masm.d.ts` so TypeScript recognizes `.masm` imports:

```ts
declare module '*.masm' {
  const content: string;
  export default content;
}
```

## Step 4: Configure Your Bundler to Import `.masm` Files

Add an `asset/source` webpack rule so `.masm` files are imported as plain text strings.

Open `next.config.ts` and add the following rule inside the `webpack` callback:

```ts
// Import .masm files as strings. Keep the existing WASM configuration.
config.module.rules.push({
  test: /\.masm$/,
  type: "asset/source",
});
```

:::tip Other bundlers

- **Vite:** use the `?raw` suffix — `import code from './masm/counter_contract.masm?raw'`
- **Other bundlers / no bundler:** use `fetch()` at runtime — `const code = await fetch('/masm/counter_contract.masm').then(r => r.text())`
  :::

## Step 5: Incrementing the Count of the Counter Contract

Create the file `lib/incrementCounterContract.ts`:

```bash
touch lib/incrementCounterContract.ts
```

Copy and paste the following code into the `lib/incrementCounterContract.ts` file:

```ts
// lib/incrementCounterContract.ts
import counterContractCode from './masm/counter_contract.masm';
import {
  AuthSecretKey,
  StorageSlot,
  StorageResult,
} from '@miden-sdk/miden-sdk/lazy';
import {
  createFundableContractAccount,
  createTutorialClient,
  fundAccountForFees,
} from './feeSupport';

export async function incrementCounterContract(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  const client = await createTutorialClient({ proverUrl: 'local' });
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterSlotName = 'miden::tutorials::counter';

  const counterAccountComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const walletSeed = new Uint8Array(32);
  crypto.getRandomValues(walletSeed);
  const auth = AuthSecretKey.rpoFalconWithRNG(walletSeed);

  const account = await createFundableContractAccount(
    client,
    walletSeed,
    auth,
    [counterAccountComponent],
  );

  await fundAccountForFees(client, account);

  const txScriptCode = `
use external_contract::counter_contract

#! Increments the counter.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    call.counter_contract::increment_count
    # => [pad(16)]
end
`;

  const script = await client.compile.txScript({
    code: txScriptCode,
    libraries: [
      {
        namespace: 'external_contract::counter_contract',
        code: counterContractCode,
      },
    ],
  });

  await client.sync();
  const { txId } = await client.transactions.execute({
    account,
    script,
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log(`Transaction committed: ${txId.toHex()}`);

  console.log('Counter contract ID:', account.id().toString());

  const counter = await client.accounts.get(account);
  // `getItem()` is typed to return a low-level `Word`, but at runtime the SDK
  // wraps the slot in a `StorageResult` whose `toBigInt()` reads the first
  // felt — the count. The cast reflects that runtime type.
  const count = counter?.storage().getItem(counterSlotName) as unknown as
    StorageResult | undefined;
  const counterValue = Number(count!.toBigInt());
  if (counterValue !== 1)
    throw new Error(`Expected counter 1, got ${counterValue}`);
  console.log('Count: ', counterValue);
}
```

To run the code above in our frontend, run the following command:

```bash
yarn dev
```

Open the browser console and click the button "Increment Counter Contract".

This is what you should see in the browser console (block number and account
ID will vary with live testnet state; the tutorial deploys a fresh counter and
increments it exactly once before reading, so the final count is always `1`):

```
Current block number:  <testnet block>
Counter contract ID: <testnet_account_id>
Count:  1
```

## Miden Assembly Counter Contract Explainer

#### Here's a breakdown of what the `get_count` procedure does:

1. Pushes the slot ID prefix and suffix for `miden::tutorials::counter` onto the stack.
2. Calls `active_account::get_item` with the slot ID.
3. Calls `sys::truncate_stack` to truncate the stack to size 16.
4. The value returned from `active_account::get_item` is still on the stack and will be returned when this procedure is called.

#### Here's a breakdown of what the `increment_count` procedure does:

1. Pushes the slot ID prefix and suffix for `miden::tutorials::counter` onto the stack.
2. Calls `active_account::get_item` with the slot ID.
3. Pushes `1` onto the stack.
4. Adds `1` to the count value returned from `active_account::get_item`.
5. Pushes the slot ID prefix and suffix again so we can write the updated count.
6. Calls `native_account::set_item` which saves the incremented count to storage.
7. Drops the previous storage word returned by `set_item`.
8. Calls `sys::truncate_stack` to leave only the 16 padding elements.

```masm
use miden::protocol::active_account
use miden::protocol::native_account
use miden::core::sys

# CONSTANTS
# =================================================================================================

const COUNTER_SLOT = word("miden::tutorials::counter")

# PUBLIC INTERFACE
# =================================================================================================

#! Returns the current count.
#!
#! Inputs:  [pad(16)]
#! Outputs: [count, pad(15)]
#!
#! Invocation: call
@account_procedure
pub proc get_count() -> felt
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [[count, 0, 0, 0], pad(16)]

    exec.sys::truncate_stack
    # => [count, pad(15)]
end

#! Increments the current count by one.
#!
#! Inputs:  [pad(16)]
#! Outputs: [pad(16)]
#!
#! Invocation: call
@account_procedure
pub proc increment_count()
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [[count, 0, 0, 0], pad(16)]

    add.1
    # => [[count + 1, 0, 0, 0], pad(16)]

    push.COUNTER_SLOT[0..2] exec.native_account::set_item
    # => [OLD_VALUE, pad(16)]

    dropw
    # => [pad(16)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

The examples follow the [protocol MASM conventions](https://github.com/0xMiden/protocol/tree/next/.claude/skills): public procedures declare typed signatures and invocation style, and stack comments list the top element first. Calls return 16 stack elements, including `pad(N)` padding; storage values are four-element words.

### Authentication Component

The counter uses a Falcon single-signature authentication component. The client
stores the secret key and signs transactions that increment the counter. Public
storage lets other accounts read its state through FPI; it does not grant them
permission to update it.

The account also includes `BasicWallet` so it can consume a native-asset funding
note and pay transaction fees. The `createFundableContractAccount` helper adds
both components and registers the account and key in the client.

### Compiling the account component

Use `client.compile.component()` to compile MASM code and its storage slots into an `AccountComponent`. Each call creates a fresh compiler instance so compilations are fully independent:

```ts
const counterAccountComponent = await client.compile.component({
  code: counterContractCode,
  slots: [StorageSlot.emptyValue(counterSlotName)],
});
```

### Creating the contract account

Use the repository helper to build the account with authentication, the custom
counter component, and `BasicWallet`, then fund it before executing a script:

```ts
const auth = AuthSecretKey.rpoFalconWithRNG(walletSeed);

const account = await createFundableContractAccount(
  client,
  walletSeed,
  auth,
  [counterAccountComponent],
);
await fundAccountForFees(client, account);
```

### Compiling and executing the custom script

Use `client.compile.txScript()` to compile a transaction script. Pass any needed libraries inline — the client links them dynamically:

```ts
const script = await client.compile.txScript({
  code: txScriptCode,
  libraries: [
    {
      namespace: 'external_contract::counter_contract',
      code: counterContractCode,
    },
  ],
});
```

Synchronize, execute the script, and wait for commitment:

```ts
await client.sync();
await client.transactions.execute({
  account,
  script,
  waitForConfirmation: true,
  timeout: 120_000,
});
```

### Custom script

This is the Miden assembly script that calls the `increment_count` procedure during the transaction.

```masm
use external_contract::counter_contract

#! Increments the counter.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    call.counter_contract::increment_count
    # => [pad(16)]
end
```

### Running the example

To run a full working example navigate to the `web-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run the web application example:

```bash
cd web-client
yarn install
yarn dev
```

### Resetting the `MidenClientDB`

The Miden webclient stores account and note data in IndexedDB. Stop or terminate the tutorial client and close other tabs using its store before resetting it. This deletes local account data and keys, so use it only for disposable tutorial accounts. The following browser-console snippet deletes the default testnet `MidenClientDB_mtst` store after the deletion request completes; change `name` if you configured a different store.

```javascript
(async () => {
  const name = 'MidenClientDB_mtst';
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Close clients and tabs using this store, then retry.'));
  });
  console.log(`Deleted database: ${name}`);
})();
```
