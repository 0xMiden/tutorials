---
title: "Consuming On-Chain Price Data from the Pragma Oracle"
sidebar_position: 13
---

# Consuming On-Chain Price Data from the Pragma Oracle

_Using the Pragma oracle to get on chain price data_

## Overview

In this tutorial, we will build a simple “price reader” smart contract that will read Bitcoin price data from the on-chain Pragma oracle.

We will use a script to call the `read_price` function in our "price reader" smart contract, which, in turn, calls the Pragma oracle via foreign procedure invocation (FPI). This tutorial lays the foundation for how you can integrate on-chain price data into your DeFi applications on Miden.

## What we'll cover

- Deploying a smart contract that can read oracle price data
- Using foreign procedure invocation to get real time on-chain price data

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly, have completed the previous tutorials on using the Rust client, and have completed the tutorial on foreign procedure invocation.

To quickly get up to speed with Miden assembly (MASM), please play around with running Miden programs in the [Miden playground](https://0xMiden.github.io/examples/).

## Step 1: Initialize your repository

Create a new Rust repository for your Miden project and navigate to it with the following command:

```bash
cargo new miden-defi-app
cd miden-defi-app
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
miden-client = { version = "0.14", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "0.14", package = "miden-client-sqlite-store" }
miden-protocol = { version = "0.14" }
rand = { version = "0.9" }
tokio = { version = "1.46", features = ["rt-multi-thread", "net", "macros", "fs"] }
```

### Step 1: Set up your `src/main.rs` file

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageMapKey, StorageSlot, StorageSlotName,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{
        domain::account::AccountStorageRequirements,
        Endpoint, GrpcClient,
    },
    transaction::{ForeignAccount, TransactionRequestBuilder},
    Client, ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use std::{path::PathBuf, sync::Arc};

// BTC/USD pair encoding per `astraly-labs/pragma-miden`.
const PAIR_PREFIX: u64 = 1;
const PAIR_SUFFIX: u64 = 0;

// Pragma oracle storage slot names.
const SLOT_NEXT_INDEX: &str = "pragma::oracle::next_publisher_index";
const SLOT_PUBLISHERS: &str = "pragma::oracle::publishers";
const SLOT_ENTRIES: &str = "pragma::publisher::entries";

// Procedure root of `get_median` on the deployed Pragma oracle.
// DEPLOYMENT-SPECIFIC: re-verify after each Pragma redeploy. Source of truth:
//   https://github.com/astraly-labs/pragma-miden#deployments
const GET_MEDIAN_PROC_HASH: &str =
    "0xb86237a8c9cd35acfef457e47282cc4da43df676df410c988eab93095d8fb3b9";

/// Walks the Pragma oracle's storage to import the oracle and all of its
/// publisher accounts as `ForeignAccount`s, with each publisher's
/// `pragma::publisher::entries` map gated on the supplied `pair_word`.
///
/// `pair_word` is `[prefix, suffix, 0, 0]`. For BTC/USD per Pragma's
/// convention, build it from `PAIR_PREFIX = 1, PAIR_SUFFIX = 0`.
///
/// Mirrors `astraly-labs/pragma-miden/examples/consume-price/src/main.rs`.
pub async fn get_oracle_foreign_accounts(
    client: &mut Client<FilesystemKeyStore>,
    oracle_account_id: AccountId,
    pair_word: Word,
) -> Result<Vec<ForeignAccount>, ClientError> {
    client.import_account_by_id(oracle_account_id).await?;
    println!("Imported oracle account: {}", oracle_account_id);

    let oracle = client
        .get_account(oracle_account_id)
        .await?
        .expect("oracle account not found");
    let storage = oracle.storage();

    let count_slot = StorageSlotName::new(SLOT_NEXT_INDEX).expect("valid slot name");
    let publishers_slot = StorageSlotName::new(SLOT_PUBLISHERS).expect("valid slot name");
    let entries_slot = StorageSlotName::new(SLOT_ENTRIES).expect("valid slot name");

    let publisher_count = storage.get_item(&count_slot)?[0].as_canonical_u64();
    let pair_key = StorageMapKey::new(pair_word);

    // Pragma reserves indices 0 and 1 as sentinels; real publishers start at 2.
    let mut foreign_accounts = Vec::with_capacity(publisher_count.saturating_sub(2) as usize + 1);
    for i in 2..publisher_count {
        let key: Word = [Felt::new(i), Felt::ZERO, Felt::ZERO, Felt::ZERO].into();
        let w: Word = storage.get_map_item(&publishers_slot, key)?;
        // The publisher record stores `[suffix, prefix, ...]` at indices [2..3].
        let pid = AccountId::new_unchecked([w[3], w[2]]);

        client.import_account_by_id(pid).await?;
        foreign_accounts.push(ForeignAccount::public(
            pid,
            AccountStorageRequirements::new([(entries_slot.clone(), [pair_key].iter())]),
        )?);
    }

    foreign_accounts.push(ForeignAccount::public(
        oracle_account_id,
        AccountStorageRequirements::default(),
    )?);

    Ok(foreign_accounts)
}

/// Fills the `oracle_reader.masm` template with deployment-specific values.
fn oracle_reader_source(oracle_id: AccountId) -> String {
    include_str!("../masm/accounts/oracle_reader.masm")
        .replace("{pair_prefix}", &PAIR_PREFIX.to_string())
        .replace("{pair_suffix}", &PAIR_SUFFIX.to_string())
        .replace("{get_median_proc_hash}", GET_MEDIAN_PROC_HASH)
        .replace("{oracle_id_prefix}", &u64::from(oracle_id.prefix()).to_string())
        .replace(
            "{oracle_id_suffix}",
            &oracle_id.suffix().as_canonical_u64().to_string(),
        )
}

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // -------------------------------------------------------------------------
    // Initialize Client
    // -------------------------------------------------------------------------
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    let keystore_path = PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await?;

    println!("Latest block: {}", client.sync_state().await?.block_num);

    // -------------------------------------------------------------------------
    // Parse and validate oracle account ID from CLI
    // -------------------------------------------------------------------------
    // `AccountId::parse` accepts both bech32 (`mtst1...`) and hex (`0x...`)
    // forms. Live Pragma oracle IDs rotate per testnet iteration; the
    // canonical source is the `astraly-labs/pragma-miden` README:
    //   https://github.com/astraly-labs/pragma-miden#deployments
    // Run as:
    //   cargo run --release --bin oracle_data_query -- <ORACLE_ACCOUNT_ID>
    let oracle_arg = std::env::args().nth(1).expect(
        "Usage: oracle_data_query <ORACLE_ACCOUNT_ID> -- pass the current testnet oracle ID from https://github.com/astraly-labs/pragma-miden#deployments",
    );
    let (oracle_account_id, _network) =
        AccountId::parse(&oracle_arg).expect("Invalid account ID format (expected bech32 or hex)");
    println!(
        "Parsed oracle ID: prefix={}, suffix={}",
        u64::from(oracle_account_id.prefix()),
        oracle_account_id.suffix().as_canonical_u64(),
    );

    // -------------------------------------------------------------------------
    // Get all foreign accounts for oracle data (BTC/USD)
    // -------------------------------------------------------------------------
    let pair_word: Word = [
        Felt::new(PAIR_PREFIX),
        Felt::new(PAIR_SUFFIX),
        Felt::ZERO,
        Felt::ZERO,
    ]
    .into();
    let foreign_accounts: Vec<ForeignAccount> =
        get_oracle_foreign_accounts(&mut client, oracle_account_id, pair_word).await?;

    // -------------------------------------------------------------------------
    // Create Oracle Reader contract
    // -------------------------------------------------------------------------
    // `oracle_reader.masm` is a *template*: the placeholders `{pair_prefix}`,
    // `{pair_suffix}`, `{get_median_proc_hash}`, `{oracle_id_prefix}`, and
    // `{oracle_id_suffix}` are substituted by the Rust binary before the
    // MASM is compiled. The raw file is **not** standalone valid MASM.
    let contract_code: String = oracle_reader_source(oracle_account_id);

    // Defensive gate: fail loudly if any placeholder leaked through, rather
    // than letting the assembler emit an opaque parse error.
    if let Some(bad) = contract_code
        .lines()
        .find(|l| l.contains('{') || l.contains('}'))
    {
        panic!(
            "oracle_reader template substitution incomplete; offending line: `{}`",
            bad.trim()
        );
    }

    let contract_slot_name =
        StorageSlotName::new("miden::tutorials::oracle_reader").expect("valid slot name");
    let contract_component_code = client
        .code_builder()
        .compile_component_code("external_contract::oracle_reader", contract_code.as_str())
        .unwrap();
    let contract_component = AccountComponent::new(
        contract_component_code,
        vec![StorageSlot::with_value(contract_slot_name.clone(), Word::default())],
        AccountComponentMetadata::new("external_contract::oracle_reader", AccountType::all()),
    )
    .unwrap();

    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    let oracle_reader_contract = AccountBuilder::new(seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(contract_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    client
        .add_account(&oracle_reader_contract, false)
        .await
        .unwrap();

    // -------------------------------------------------------------------------
    // Build the script that calls our `get_price` procedure
    // -------------------------------------------------------------------------
    let script_code = include_str!("../masm/scripts/oracle_reader_script.masm");

    // Link the oracle reader contract code into the same `CodeBuilder` chain
    // that compiles the script, so the assembler shares the client's
    // persisted source manager (avoids the source-span mismatch from
    // miden-vm#2778).
    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::oracle_reader", contract_code.as_str())
        .unwrap()
        .compile_tx_script(script_code)
        .unwrap();

    let tx_increment_request = TransactionRequestBuilder::new()
        .foreign_accounts(foreign_accounts)
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_new_transaction(oracle_reader_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();

    Ok(())
}
```

_Don't run this code just yet, we still need to create our smart contract that queries the oracle_

The oracle account ID is read from the first CLI argument (see "Running the tutorial" at the bottom of this page) and the BTC/USD pair is encoded as `[PAIR_PREFIX = 1, PAIR_SUFFIX = 0, 0, 0]` per [Pragma's pair convention](https://github.com/astraly-labs/pragma-miden/blob/main/examples/consume-price/src/main.rs). The `get_oracle_foreign_accounts` function mirrors the walk in Pragma's `consume-price` example: read `pragma::oracle::next_publisher_index`, walk the `pragma::oracle::publishers` map for `i in 2..publisher_count` (Pragma reserves 0 and 1 as sentinels), then for each publisher request its `pragma::publisher::entries` map gated on the `pair_word`. The `trading_pair` requirement is therefore explicit in the function signature; passing a different `pair_word` reads a different price.

:::note
The live oracle path is currently blocked pending a v0.14-compatible Pragma deployment. Pragma's source repo is on `miden-protocol` v0.13; the migration is tracked in [astraly-labs/pragma-miden#40](https://github.com/astraly-labs/pragma-miden/pull/40) (open PR). After Pragma migrates, the oracle account ID _and_ the `get_median` procedure hash hardcoded in `oracle_data_query.rs` (constant `GET_MEDIAN_PROC_HASH`) must be re-verified against the new deployment before the tutorial can be relied on. Both values are deployment-specific; do not assume they survive a redeploy unchanged.
:::

## Step 2: Build the price reader smart contract and script

Just like in previous tutorials, for better code organization we will separate the Miden assembly code from our Rust code.

Create a directory named `masm` at the **root** of your `miden-counter-contract` directory. This will contain our contract and script masm code.

Initialize the `masm` directory:

```bash
mkdir -p masm/accounts masm/scripts
```

This will create:

```text
masm/
├── accounts/
└── scripts/
```

### Oracle price reader smart contract

Below is our oracle price reader contract. It has a single exported procedure: `get_price`.

The import `miden::protocol::tx` contains `tx::execute_foreign_procedure`, which we use to read the price from the oracle contract.

This file is a **template**: the placeholders `{pair_prefix}`, `{pair_suffix}`, `{get_median_proc_hash}`, `{oracle_id_prefix}`, and `{oracle_id_suffix}` are substituted by the Rust binary (`oracle_reader_source(...)`) before the MASM is compiled. The raw file as shown here is **not** standalone valid MASM. The pair encoding is deployment-agnostic for any `(PAIR_PREFIX, PAIR_SUFFIX)` trading pair, but `{get_median_proc_hash}` and the oracle account ID are deployment-specific to Pragma's testnet oracle and must be re-verified after every Pragma redeploy.

#### Here's a breakdown of what the `get_price` procedure does:

1. Pushes the BTC/USD pair onto the stack as `[0, 0, {pair_suffix}, {pair_prefix}]`. With the pair encoding `(PAIR_PREFIX = 1, PAIR_SUFFIX = 0)`, this becomes `push.0.0.0.1`.
2. Pushes the deployment-specific procedure root of `get_median` onto the stack.
3. Pushes the oracle account ID prefix and suffix onto the stack.
4. Calls `tx::execute_foreign_procedure` to invoke `get_median` via FPI.

Inside of the `masm/accounts/` directory, create the `oracle_reader.masm` file:

```masm
# This file is a template, not standalone valid MASM.
# See `oracle_reader_source(...)` in src/main.rs for substitution.

use miden::protocol::tx

#! Reads the current price for a single trading pair from the Pragma oracle
#! via foreign procedure invocation.
#!
#! Inputs:  []
#! Outputs: [price]
pub proc get_price
    push.0.0.{pair_suffix}.{pair_prefix}
    # => [PAIR]

    push.{get_median_proc_hash}
    # => [GET_MEDIAN_HASH, PAIR]

    push.{oracle_id_prefix}.{oracle_id_suffix}
    # => [oracle_id_prefix, oracle_id_suffix, GET_MEDIAN_HASH, PAIR]

    exec.tx::execute_foreign_procedure
    # => [price]

    debug.stack
    # => [price]

    dropw dropw
end
```

**Note**: _It's a good habit to add comments above each line of MASM code with the expected stack state. This improves readability and helps with debugging._

### Create the script which calls the `get_price` procedure

This is a Miden assembly script that will call the `get_price` procedure during the transaction.

Inside of the `masm/scripts/` directory, create the `oracle_reader_script.masm` file:

```masm
use external_contract::oracle_reader

begin
    exec.oracle_reader::get_price
end
```

## Step 3: Run the program

This tutorial requires a v0.14-compatible Pragma oracle deployment. The current Pragma deployment is on `miden-protocol` v0.13 (see [astraly-labs/pragma-miden#40](https://github.com/astraly-labs/pragma-miden/pull/40), open), so the live FPI walk will fail until that migration lands. **After Pragma redeploys, you must re-verify the oracle account ID _and_ the `GET_MEDIAN_PROC_HASH` constant in `src/main.rs` against the new deployment** — both are deployment-specific and may change with each redeploy. Re-running the tutorial without re-verifying these constants is not safe. Get the current testnet oracle account ID (bech32 or hex) from the [astraly-labs/pragma-miden README](https://github.com/astraly-labs/pragma-miden#deployments) and pass it as a CLI argument:

```bash
cargo run --release -- <ORACLE_ACCOUNT_ID>
```

The output of our program will look something like this:

```text
cleared sqlite store: ./store.sqlite3
Latest block: 648397
Oracle accountId prefix: V0(AccountIdPrefixV0 { prefix: 5721796415433354752 }) suffix: 599064613630720
Stack state before step 8766:
├──  0: 82655190335
├──  1: 0
├──  2: 0
├──  3: 0
├──  4: 0
├──  5: 0
├──  6: 0
├──  7: 0
├──  8: 0
├──  9: 0
├── 10: 0
├── 11: 0
├── 12: 0
├── 13: 0
├── 14: 0
├── 15: 0
├── 16: 0
├── 17: 0
├── 18: 0
└── 19: 0

View transaction on MidenScan: https://testnet.midenscan.com/tx/0xc8951190564d5c3ac59fe99d8911f8c17f5b59ba542e2eb860413898902f3722
```

As you can see, at the top of the stack is the price returned from the Pragma oracle. The price is returned with 6 decimal places. Currently Pragma only publishes the `BTC/USD` price feed on testnet.

### Running the tutorial

To run this tutorial end-to-end, navigate to the `rust-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run:

```bash
cd rust-client
cargo run --release --bin oracle_data_query -- <ORACLE_ACCOUNT_ID>
```

where `<ORACLE_ACCOUNT_ID>` is Pragma's deployed oracle account ID on testnet.

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](./unauthenticated_note_how_to.md)
