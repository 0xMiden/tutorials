---
title: 'Foreign Procedure Invocation'
sidebar_position: 7
---

# Foreign Procedure Invocation Tutorial

_Using foreign procedure invocation to craft read-only cross-contract calls with the Miden client_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.

:::

## Overview

In the previous tutorial we deployed a fresh counter smart contract and incremented its count with a transaction script.

In this tutorial we will cover the basics of "foreign procedure invocation" (FPI) using the Miden client. This tutorial is self-contained: it deploys its own counter contract from scratch, then builds a "count copy" smart contract, and uses FPI to read the count from the counter contract and copy it to the count reader's local storage.

Foreign procedure invocation (FPI) is a powerful tool for building composable smart contracts in Miden. FPI allows one smart contract or note to read the state of another contract.

The term "foreign procedure invocation" might sound a bit verbose, but it is as simple as one smart contract calling a non-state modifying procedure in another smart contract. The "EVM equivalent" of foreign procedure invocation would be a smart contract calling a read-only function in another contract.

FPI is useful for developing smart contracts that extend the functionality of existing contracts on Miden. FPI is the core primitive used by price oracles on Miden.

## What We Will Build

![Count Copy FPI diagram](../img/count_copy_fpi_diagram.png)

The diagram above depicts the "count copy" smart contract using foreign procedure invocation to read the count state of the counter contract. After reading the state via FPI, the "count copy" smart contract writes the value returned from the counter contract to storage.

## What we'll cover

- Foreign Procedure Invocation (FPI) with the Miden client
- Building a "count copy" smart contract
- Executing cross-contract calls in the browser

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

This tutorial assumes you have a basic understanding of Miden assembly and completed the previous tutorial on incrementing the counter contract. To quickly get up to speed with Miden assembly (MASM), please play around with running basic Miden assembly programs in the [Miden playground](https://0xmiden.github.io/examples/).

## Step 1: Initialize your Next.js project

1. Create a new Next.js app with TypeScript:

   ```bash
   npx create-next-app@latest miden-fpi-app --typescript
   ```

   Hit enter for all terminal prompts.

2. Change into the project directory:

   ```bash
   cd miden-fpi-app
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

## Step 2: Edit the `app/page.tsx` file

Add the following code to the `app/page.tsx` file. This code defines the main page of our web application:

```tsx
'use client';
import { useState } from 'react';
import { foreignProcedureInvocation } from '../lib/foreignProcedureInvocation';

export default function Home() {
  const [isFPIRunning, setIsFPIRunning] = useState(false);

  const handleForeignProcedureInvocation = async () => {
    setIsFPIRunning(true);
    await foreignProcedureInvocation();
    setIsFPIRunning(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black text-slate-800 dark:text-slate-100">
      <div className="text-center">
        <h1 className="text-4xl font-semibold mb-4">Miden FPI Web App</h1>
        <p className="mb-6">
          Open your browser console to see Miden client logs.
        </p>

        <div className="max-w-sm w-full bg-gray-800/20 border border-gray-600 rounded-2xl p-6 mx-auto flex flex-col gap-4">
          <button
            onClick={handleForeignProcedureInvocation}
            className="w-full px-6 py-3 text-lg cursor-pointer bg-transparent border-2 border-orange-600 text-white rounded-lg transition-all hover:bg-orange-600 hover:text-white"
          >
            {isFPIRunning
              ? 'Working...'
              : 'Foreign Procedure Invocation Tutorial'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

## Step 3: Write the MASM Contract Files

The MASM (Miden Assembly) code for our smart contracts lives in separate `.masm` files. Create a `lib/masm/` directory and add the two contract files:

```bash
mkdir -p lib/masm
```

### Counter contract

Create the file `lib/masm/counter_contract.masm`. This is the same counter contract introduced in the previous tutorial; we deploy a fresh instance of it in Step 5 below and also need its source code here so we can compile it locally and obtain the procedure hash for `get_count`:

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

### Count reader contract

Create the file `lib/masm/count_reader.masm`. This is the new "count copy" contract that reads the counter value via FPI and stores it locally:

```masm
use miden::protocol::native_account
use miden::protocol::tx
use miden::core::sys
use {AccountId, AccountProcedureRoot} from miden::protocol::types

# CONSTANTS
# =================================================================================================

const COUNT_READER_SLOT = word("miden::tutorials::count_reader")

# PUBLIC INTERFACE
# =================================================================================================

#! Copies the count returned by the foreign counter into this account's storage.
#!
#! Inputs:  [foreign_account_id_{suffix,prefix}, FOREIGN_PROC_ROOT, pad(10)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - foreign_account_id_{suffix,prefix} identifies the public counter account.
#! - FOREIGN_PROC_ROOT is the root of its get_count procedure.
#!
#! Invocation: call
@account_procedure
@locals(6)
pub proc copy_count(foreign_account_id: AccountId, foreign_proc_root: AccountProcedureRoot)
    # save the foreign target while preparing its sixteen zero inputs
    loc_store.4 loc_store.5 loc_storew_le.0 dropw
    # => [pad(16)]

    padw padw padw padw
    # => [foreign_procedure_inputs(16), pad(16)]

    padw loc_loadw_le.0 loc_load.5 loc_load.4
    # => [foreign_account_id_suffix, foreign_account_id_prefix, FOREIGN_PROC_ROOT, foreign_procedure_inputs(16), pad(16)]

    exec.tx::execute_foreign_procedure
    # => [[count, 0, 0, 0], pad(28)]

    push.COUNT_READER_SLOT[0..2]
    # => [slot_id_suffix, slot_id_prefix, [count, 0, 0, 0], pad(28)]

    exec.native_account::set_item
    # => [OLD_VALUE, pad(28)]

    dropw
    # => [pad(28)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

### Type declaration

Create `lib/masm/masm.d.ts` so TypeScript recognizes `.masm` imports:

```ts
declare module '*.masm' {
  const content: string;
  export default content;
}
```

## Step 4: Configure Your Bundler to Import `.masm` Files

We need to tell our bundler to treat `.masm` files as plain text strings. In Next.js, add an `asset/source` webpack rule.

Open `next.config.ts` and add the highlighted rule inside the `webpack` callback:

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

## Step 5: Create the Foreign Procedure Invocation Implementation

Create the file `lib/foreignProcedureInvocation.ts` and add the following code.

```bash
touch lib/foreignProcedureInvocation.ts
```

Copy and paste the following code into the `lib/foreignProcedureInvocation.ts` file:

```ts
// lib/foreignProcedureInvocation.ts
import counterContractCode from './masm/counter_contract.masm';
import countReaderCode from './masm/count_reader.masm';
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

export async function foreignProcedureInvocation(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('foreignProcedureInvocation() can only run in the browser');
    return;
  }

  const client = await createTutorialClient({ proverUrl: 'local' });
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterSlotName = 'miden::tutorials::counter';
  const countReaderSlotName = 'miden::tutorials::count_reader';

  // -------------------------------------------------------------------------
  // STEP 1: Deploy the Counter Contract
  // -------------------------------------------------------------------------
  console.log('\n[STEP 1] Deploying counter contract.');

  const counterComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const counterSeed = new Uint8Array(32);
  crypto.getRandomValues(counterSeed);
  const counterAuth = AuthSecretKey.rpoFalconWithRNG(counterSeed);

  const counterAccount = await createFundableContractAccount(
    client,
    counterSeed,
    counterAuth,
    [counterComponent],
  );

  await fundAccountForFees(client, counterAccount);

  // Deploy the counter to the node by executing a transaction on it
  const deployScript = await client.compile.txScript({
    code: `
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
`,
    libraries: [
      {
        namespace: 'external_contract::counter_contract',
        code: counterContractCode,
      },
    ],
  });

  // Wait for the deploy transaction to be committed to a block
  // before using it as a foreign account in FPI
  await client.sync();
  await client.transactions.execute({
    account: counterAccount,
    script: deployScript,
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log('Counter contract ID:', counterAccount.id().toString());

  // -------------------------------------------------------------------------
  // STEP 2: Create the Count Reader Contract
  // -------------------------------------------------------------------------
  console.log('\n[STEP 2] Creating count reader contract.');

  const countReaderComponent = await client.compile.component({
    code: countReaderCode,
    slots: [StorageSlot.emptyValue(countReaderSlotName)],
  });

  const readerSeed = new Uint8Array(32);
  crypto.getRandomValues(readerSeed);
  const readerAuth = AuthSecretKey.rpoFalconWithRNG(readerSeed);

  const countReaderAccount = await createFundableContractAccount(
    client,
    readerSeed,
    readerAuth,
    [countReaderComponent],
  );

  await fundAccountForFees(client, countReaderAccount);

  console.log('Count reader contract ID:', countReaderAccount.id().toString());

  // -------------------------------------------------------------------------
  // STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
  // -------------------------------------------------------------------------
  console.log(
    '\n[STEP 3] Call counter contract with FPI from count reader contract',
  );

  const getCountProcHash = counterComponent.getProcedureHash('get_count');

  const fpiScriptCode = `
use external_contract::count_reader_contract
use miden::core::sys

#! Copies a public counter through the reader account.
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

    push.${getCountProcHash}
    # => [GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().prefix()}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().suffix()}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => [pad(16)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
`;

  const script = await client.compile.txScript({
    code: fpiScriptCode,
    libraries: [
      {
        namespace: 'external_contract::count_reader_contract',
        code: countReaderCode,
      },
    ],
  });

  await client.sync();
  const { txId } = await client.transactions.execute({
    account: countReaderAccount,
    script,
    foreignAccounts: [counterAccount],
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log(`Transaction committed: ${txId.toHex()}`);

  const updatedCountReader = await client.accounts.get(countReaderAccount);
  // `getItem()` is typed to return a low-level `Word`, but at runtime the SDK
  // wraps the slot in a `StorageResult` whose `toBigInt()` reads the first
  // felt — the count. The cast reflects that runtime type.
  const countReaderStorage = updatedCountReader
    ?.storage()
    .getItem(countReaderSlotName) as unknown as StorageResult | undefined;

  if (countReaderStorage) {
    const countValue = Number(countReaderStorage.toBigInt());
    if (countValue !== 1)
      throw new Error(`Expected copied counter 1, got ${countValue}`);
    console.log('Count copied via Foreign Procedure Invocation:', countValue);
  } else {
    throw new Error('Count reader storage was not available after commitment');
  }

  console.log('\nForeign Procedure Invocation Transaction completed!');
}
```

To run the code above in our frontend, run the following command:

```bash
yarn dev
```

Open the browser console and click the button "Foreign Procedure Invocation Tutorial".

This is what you should see in the browser console:

```
Current block number:  121098

[STEP 1] Deploying counter contract.
Counter contract ID: 0xab9cb9598cd6501012de6f8659e2ea

[STEP 2] Creating count reader contract.
Count reader contract ID: 0x90128b4e27f34500000720bedaa49b

[STEP 3] Call counter contract with FPI from count reader contract
Count copied via Foreign Procedure Invocation: 1

Foreign Procedure Invocation Transaction completed!
```

## Understanding the Count Reader Contract

The count reader smart contract contains a `copy_count` procedure that uses `tx::execute_foreign_procedure` to call the `get_count` procedure in the counter contract.

```masm
use miden::protocol::native_account
use miden::protocol::tx
use miden::core::sys
use {AccountId, AccountProcedureRoot} from miden::protocol::types

# CONSTANTS
# =================================================================================================

const COUNT_READER_SLOT = word("miden::tutorials::count_reader")

# PUBLIC INTERFACE
# =================================================================================================

#! Copies the count returned by the foreign counter into this account's storage.
#!
#! Inputs:  [foreign_account_id_{suffix,prefix}, FOREIGN_PROC_ROOT, pad(10)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - foreign_account_id_{suffix,prefix} identifies the public counter account.
#! - FOREIGN_PROC_ROOT is the root of its get_count procedure.
#!
#! Invocation: call
@account_procedure
@locals(6)
pub proc copy_count(foreign_account_id: AccountId, foreign_proc_root: AccountProcedureRoot)
    # save the foreign target while preparing its sixteen zero inputs
    loc_store.4 loc_store.5 loc_storew_le.0 dropw
    # => [pad(16)]

    padw padw padw padw
    # => [foreign_procedure_inputs(16), pad(16)]

    padw loc_loadw_le.0 loc_load.5 loc_load.4
    # => [foreign_account_id_suffix, foreign_account_id_prefix, FOREIGN_PROC_ROOT, foreign_procedure_inputs(16), pad(16)]

    exec.tx::execute_foreign_procedure
    # => [[count, 0, 0, 0], pad(28)]

    push.COUNT_READER_SLOT[0..2]
    # => [slot_id_suffix, slot_id_prefix, [count, 0, 0, 0], pad(28)]

    exec.native_account::set_item
    # => [OLD_VALUE, pad(28)]

    dropw
    # => [pad(28)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

To call the `get_count` procedure, we push its hash along with the counter contract's ID suffix and prefix onto the stack before calling `tx::execute_foreign_procedure`.

The stack state before calling `tx::execute_foreign_procedure` should look like this:

```
# => [foreign_account_id_suffix, foreign_account_id_prefix, FOREIGN_PROC_ROOT, foreign_procedure_inputs(16), pad(16)]
```

`execute_foreign_procedure` always requires exactly 16 `foreign_procedure_inputs` on the stack below the procedure hash and account ID. Since `get_count` takes no arguments, `copy_count` prepares 16 zero field elements (four words: `padw padw padw padw`) as the inputs. The transaction script only passes the account ID and procedure root; the reader saves them in local memory while preparing those inputs.

After calling the `get_count` procedure in the counter contract, we save the count into the
`miden::tutorials::count_reader` storage slot.

## Understanding the Transaction Script

The transaction script that executes the foreign procedure invocation looks like this:

```masm
use external_contract::count_reader_contract
use miden::core::sys

#! Copies a public counter through the reader account.
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

    push.${getCountProcHash}
    # => [GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().prefix()}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().suffix()}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => [pad(16)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

This script:

1. Discards the unused transaction script arguments.
2. Pushes the procedure root of `get_count`.
3. Pushes the counter account ID prefix, then suffix, leaving the suffix on top.
4. Calls `copy_count`, which prepares the foreign call and stores the result.
5. Truncates the stack.

## Key Miden Client Concepts for FPI

### Getting Procedure Hashes

Compile the counter contract component using `client.compile.component()` and call `getProcedureHash()` to obtain the hash needed by the FPI script:

```ts
const counterComponent = await client.compile.component({
  code: counterContractCode,
  slots: [StorageSlot.emptyValue(counterSlotName)],
});

const getCountProcHash = counterComponent.getProcedureHash('get_count');
```

### Compiling the Transaction Script with a Library

Use `client.compile.txScript()` and pass the count reader library inline. The library is linked dynamically so the script can call its procedures:

```ts
const script = await client.compile.txScript({
  code: fpiScriptCode,
  libraries: [
    {
      namespace: 'external_contract::count_reader_contract',
      code: countReaderCode,
    },
  ],
});
```

### Foreign Accounts

Pass the foreign account directly in the `execute()` call using the `foreignAccounts` option. The client creates the `ForeignAccount` and `AccountStorageRequirements` internally — no manual construction needed:

```ts
await client.transactions.execute({
  account: countReaderAccount,
  script,
  foreignAccounts: [counterAccount],
  waitForConfirmation: true,
  timeout: 120_000,
});
```

## Summary

In this tutorial we created a smart contract that calls the `get_count` procedure in the counter contract using foreign procedure invocation, and then saves the returned value to its local storage using the Miden client.

The key steps were:

1. Writing the MASM contract files (`counter_contract.masm` and `count_reader.masm`)
2. Configuring the bundler to import `.masm` files as strings
3. Creating a count reader contract with a `copy_count` procedure
4. Deploying the counter contract on-chain
5. Getting the procedure hash for the `get_count` function
6. Building a transaction script that calls our count reader contract
7. Executing the transaction with a foreign account reference

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

### Continue learning

Next tutorial: [Creating Multiple Notes](creating_multiple_notes_tutorial.md)
