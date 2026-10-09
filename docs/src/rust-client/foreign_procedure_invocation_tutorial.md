---
title: "Foreign Procedure Invocation"
sidebar_position: 7
---

# Foreign Procedure Invocation Tutorial

_Using foreign procedure invocation to craft read-only cross-contract calls in the Miden VM_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v017-examples).

## Overview

In previous tutorials we deployed a public counter contract and incremented the count from a different client instance.

In this tutorial we will cover the basics of "foreign procedure invocation" (FPI) in the Miden VM. To demonstrate FPI, we will build a "count copy" smart contract that reads the count from our previously deployed counter contract and copies the count to its own local storage.

Foreign procedure invocation (FPI) is a powerful tool for building smart contracts in the Miden VM. FPI allows one smart contract to call "read-only" procedures in other smart contracts.

The term "foreign procedure invocation" might sound a bit verbose, but it is as simple as one smart contract calling a non-state modifying procedure in another smart contract. The "EVM equivalent" of foreign procedure invocation would be a smart contract calling a read-only function in another contract.

FPI is useful for developing smart contracts that extend the functionality of existing contracts on Miden. FPI is the core primitive used by price oracles on Miden.

## What We Will Build

![count copy FPI diagram](../img/count_copy_fpi_diagram.png)

The diagram above depicts the "count copy" smart contract using foreign procedure invocation to read the count state of the counter contract. After reading the state via FPI, the "count copy" smart contract writes the value returned from the counter contract to storage.

## What we'll cover

- Foreign Procedure Invocation (FPI)
- Building a "count copy" Smart Contract

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly and a counter deployed using the [counter contract tutorial](./counter_contract_tutorial.md). Keep its printed `mtst1...` account ID. The reader runs in a separate Cargo project and reads that counter's public state.

## Step 1: Set up your repository

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-fpi
cd miden-fpi
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Add these dependencies and the development profile to your `Cargo.toml`:

```toml
[dependencies]
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.17.2", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.17.2", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.17.1" }
rand = { version = "0.10" }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

## Step 2: Set up the "count reader" contract

The reader contract in `masm/accounts/count_reader.masm` reads the counter’s value through FPI.

`masm/accounts/count_reader.masm`:

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

In the count reader smart contract we have a `copy_count` procedure that uses `tx::execute_foreign_procedure` to call the `get_count` procedure in the counter contract.

To call the `get_count` procedure, we push its hash along with the counter contract's ID suffix and prefix.

This is what the stack state should look like before we call `tx::execute_foreign_procedure`:

```text
# => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, foreign_procedure_inputs(16)]
```

`execute_foreign_procedure` always requires exactly 16 `foreign_procedure_inputs` on the stack
below the procedure hash and account ID. Since `get_count` takes no arguments, we pass 16 zero
felts (`padw padw padw padw`, four words) as the inputs. The reader prepares these
inputs internally after saving the account ID and procedure root in local memory. The
caller therefore passes only those six identifying felts. After the foreign call,
the count is the first of 16 output elements; the reader stores its word, discards
the previous storage value, and truncates the remaining padding.

After calling the `get_count` procedure in the counter contract, we save the count into the
`miden::tutorials::count_reader` storage slot.

The transaction script is defined in `masm/scripts/reader_script.masm`:

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

    push.{get_count_proc_hash}
    # => [GET_COUNT_HASH, pad(16)]

    push.{account_id_prefix}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.{account_id_suffix}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => [pad(22)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
```

The braces mark template values, not valid MASM operands. The Rust code replaces the procedure root and both account ID elements before assembling the script.

## Step 3: Set up your `src/main.rs` file

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    ClientError, Word,
    account::{
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient, domain::account::AccountStorageRequirements},
    transaction::{ForeignAccount, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let network = TutorialNetwork::from_env()?;
    let endpoint = network.endpoint();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
        &endpoint, timeout_ms,
    )));

    // Initialize keystore
    let keystore_path = PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await?;

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);
    let fee_config = FeeConfig::from_client(&client, network).await?;

    // -------------------------------------------------------------------------
    // STEP 1: Create the Count Reader Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating count reader contract.");

    // Read the MASM source from the tutorials repository.
    let count_reader_code =
        std::fs::read_to_string("../tutorials/masm/accounts/count_reader.masm").unwrap();

    let count_reader_slot_name =
        StorageSlotName::new("miden::tutorials::count_reader").expect("valid slot name");
    let count_reader_component_code = client
        .code_builder()
        .compile_component_code(
            "external_contract::count_reader_contract",
            &count_reader_code,
        )
        .unwrap();
    let count_reader_component = AccountComponent::new(
        count_reader_component_code,
        vec![StorageSlot::with_value(
            count_reader_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::count_reader_contract"),
    )
    .unwrap();

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let count_reader_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(count_reader_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "count_reader hash: {:?}",
        count_reader_contract.to_commitment()
    );
    println!("count_reader id: {:?}", count_reader_contract.id());

    client
        .add_account(&count_reader_contract, false)
        .await
        .unwrap();
    fund_account_for_fees(&mut client, count_reader_contract.id(), &fee_config).await?;

    Ok(())
}
```

Run the following command to execute src/main.rs:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

The output includes the reader's initial commitment and ID (abridged; values vary):

```text
Latest block: <block_number>

[STEP 1] Creating count reader contract.
count_reader hash: Word([...])
count_reader id: V1(AccountIdV1 { suffix: ..., prefix: ... })
```

## Step 4: Import the pre-deployed counter contract

The FPI call needs a counter contract already deployed on-chain. Copy its `mtst1...` testnet account ID into the `MIDEN_COUNTER_ACCOUNT_ID` environment variable. Using an input avoids baking in an address that becomes invalid after a testnet reset.

Insert this fragment inside `main`, immediately before its final `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Build & Get State of the Counter Contract
// -------------------------------------------------------------------------
println!("\n[STEP 2] Building counter contract from public state");

// Pass the account ID printed by `counter_contract_deploy` as the first argument, or via
// `MIDEN_COUNTER_ACCOUNT_ID`.
let counter_contract_bech32 = std::env::args()
    .nth(1)
    .or_else(|| std::env::var("MIDEN_COUNTER_ACCOUNT_ID").ok())
    .expect("pass the counter account ID from counter_contract_deploy");
let (account_network, counter_contract_id) =
    AccountId::from_bech32(&counter_contract_bech32).expect("invalid counter account ID");
assert_eq!(
    account_network,
    network.network_id(),
    "counter account must match the selected tutorial network"
);

println!("counter contract id: {:?}", counter_contract_id);

client
    .import_account_by_id(counter_contract_id)
    .await
    .unwrap();

let counter_contract = client
    .get_account(counter_contract_id)
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "Account details: {:?}",
    counter_contract.storage().slots().first().unwrap()
);
```

## Step 5: Call the counter contract via foreign procedure invocation

Insert this fragment after the import step, inside `main` and before `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
// -------------------------------------------------------------------------
println!("\n[STEP 3] Call counter contract with FPI from count reader contract");

let counter_contract_code =
    std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

// Compile the counter as a component (same path as the deploy binary) to get
// the correct procedure root that matches the on-chain MAST.
let counter_component_code = client
    .code_builder()
    .compile_component_code(
        "external_contract::counter_contract",
        &counter_contract_code,
    )
    .unwrap();
let counter_component = AccountComponent::new(
    counter_component_code,
    vec![],
    AccountComponentMetadata::new("external_contract::counter_contract"),
)
.unwrap();

let get_count_root = counter_component
    .component_code()
    .get_procedure_root_by_path("external_contract::counter_contract::get_count")
    .expect("get_count export not found");
let get_count_hash = format!("{}", get_count_root);

println!("get_count hash: {:?}", get_count_hash);
println!("counter id prefix: {:?}", counter_contract_id.prefix());
println!("counter id suffix: {:?}", counter_contract_id.suffix());

let script_code = std::fs::read_to_string("../tutorials/masm/scripts/reader_script.masm")
    .unwrap()
    .replace("{get_count_proc_hash}", &get_count_hash)
    .replace(
        "{account_id_suffix}",
        &counter_contract_id.suffix().as_canonical_u64().to_string(),
    )
    .replace(
        "{account_id_prefix}",
        &u64::from(counter_contract_id.prefix()).to_string(),
    );

// Link the count reader contract code into the same `CodeBuilder` chain
// that compiles the script.
let tx_script = client
    .code_builder()
    .with_linked_module(
        "external_contract::count_reader_contract",
        &count_reader_code,
    )
    .unwrap()
    .compile_tx_script(script_code.as_str())
    .unwrap();

let foreign_account =
    ForeignAccount::public(counter_contract_id, AccountStorageRequirements::default()).unwrap();

let tx_request = TransactionRequestBuilder::new()
    .foreign_accounts([foreign_account])
    .custom_script(tx_script)
    .build()
    .unwrap();

let tx_id = client
    .submit_tutorial_transaction(count_reader_contract.id(), tx_request)
    .await
    .unwrap();

println!(
    "View transaction on MidenScan: {}/tx/{:?}",
    network.explorer_url(),
    tx_id
);

client.sync_state().await.unwrap();
sleep(Duration::from_secs(5)).await;
client.sync_state().await.unwrap();

// Retrieve final state to confirm the count was copied.
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let account_1 = client
    .get_account(counter_contract_id)
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "counter contract storage: {:?}",
    account_1.storage().get_item(&counter_slot_name)
);

let account_2 = client
    .get_account(count_reader_contract.id())
    .await
    .unwrap()
    .expect("count reader contract not found");
println!(
    "count reader contract storage: {:?}",
    account_2.storage().get_item(&count_reader_slot_name)
);
assert_eq!(
    account_2
        .storage()
        .get_item(&count_reader_slot_name)
        .unwrap(),
    account_1.storage().get_item(&counter_slot_name).unwrap(),
    "FPI must copy the current counter value",
);
```

The `.foreign_accounts()` method declares the foreign state that the client must fetch and prove. `AccountStorageRequirements::default()` suffices here because `get_count` reads a value slot. A procedure that reads map entries must also request proofs for the specific map keys it uses. The MASM script performs the actual foreign call.

## Summary

In this tutorial, we created a smart contract that calls the counter's `get_count` procedure through FPI and saves the returned value in its own storage. The reader account pays for this transaction; the foreign counter is read-only and is not charged or modified.

The final `src/main.rs` file should look like this:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    ClientError, Word,
    account::{
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient, domain::account::AccountStorageRequirements},
    transaction::{ForeignAccount, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let network = TutorialNetwork::from_env()?;
    let endpoint = network.endpoint();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
        &endpoint, timeout_ms,
    )));

    // Initialize keystore
    let keystore_path = PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await?;

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);
    let fee_config = FeeConfig::from_client(&client, network).await?;

    // -------------------------------------------------------------------------
    // STEP 1: Create the Count Reader Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating count reader contract.");

    // Read the MASM source from the tutorials repository.
    let count_reader_code =
        std::fs::read_to_string("../tutorials/masm/accounts/count_reader.masm").unwrap();

    let count_reader_slot_name =
        StorageSlotName::new("miden::tutorials::count_reader").expect("valid slot name");
    let count_reader_component_code = client
        .code_builder()
        .compile_component_code(
            "external_contract::count_reader_contract",
            &count_reader_code,
        )
        .unwrap();
    let count_reader_component = AccountComponent::new(
        count_reader_component_code,
        vec![StorageSlot::with_value(
            count_reader_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::count_reader_contract"),
    )
    .unwrap();

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let count_reader_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(count_reader_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "count_reader hash: {:?}",
        count_reader_contract.to_commitment()
    );
    println!("count_reader id: {:?}", count_reader_contract.id());

    client
        .add_account(&count_reader_contract, false)
        .await
        .unwrap();
    fund_account_for_fees(&mut client, count_reader_contract.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // STEP 2: Build & Get State of the Counter Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Building counter contract from public state");

    // Pass the account ID printed by `counter_contract_deploy` as the first argument, or via
    // `MIDEN_COUNTER_ACCOUNT_ID`.
    let counter_contract_bech32 = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("MIDEN_COUNTER_ACCOUNT_ID").ok())
        .expect("pass the counter account ID from counter_contract_deploy");
    let (account_network, counter_contract_id) =
        AccountId::from_bech32(&counter_contract_bech32).expect("invalid counter account ID");
    assert_eq!(
        account_network,
        network.network_id(),
        "counter account must match the selected tutorial network"
    );

    println!("counter contract id: {:?}", counter_contract_id);

    client
        .import_account_by_id(counter_contract_id)
        .await
        .unwrap();

    let counter_contract = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "Account details: {:?}",
        counter_contract.storage().slots().first().unwrap()
    );

    // -------------------------------------------------------------------------
    // STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Call counter contract with FPI from count reader contract");

    let counter_contract_code =
        std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

    // Compile the counter as a component (same path as the deploy binary) to get
    // the correct procedure root that matches the on-chain MAST.
    let counter_component_code = client
        .code_builder()
        .compile_component_code(
            "external_contract::counter_contract",
            &counter_contract_code,
        )
        .unwrap();
    let counter_component = AccountComponent::new(
        counter_component_code,
        vec![],
        AccountComponentMetadata::new("external_contract::counter_contract"),
    )
    .unwrap();

    let get_count_root = counter_component
        .component_code()
        .get_procedure_root_by_path("external_contract::counter_contract::get_count")
        .expect("get_count export not found");
    let get_count_hash = format!("{}", get_count_root);

    println!("get_count hash: {:?}", get_count_hash);
    println!("counter id prefix: {:?}", counter_contract_id.prefix());
    println!("counter id suffix: {:?}", counter_contract_id.suffix());

    let script_code = std::fs::read_to_string("../tutorials/masm/scripts/reader_script.masm")
        .unwrap()
        .replace("{get_count_proc_hash}", &get_count_hash)
        .replace(
            "{account_id_suffix}",
            &counter_contract_id.suffix().as_canonical_u64().to_string(),
        )
        .replace(
            "{account_id_prefix}",
            &u64::from(counter_contract_id.prefix()).to_string(),
        );

    // Link the count reader contract code into the same `CodeBuilder` chain
    // that compiles the script.
    let tx_script = client
        .code_builder()
        .with_linked_module(
            "external_contract::count_reader_contract",
            &count_reader_code,
        )
        .unwrap()
        .compile_tx_script(script_code.as_str())
        .unwrap();

    let foreign_account =
        ForeignAccount::public(counter_contract_id, AccountStorageRequirements::default()).unwrap();

    let tx_request = TransactionRequestBuilder::new()
        .foreign_accounts([foreign_account])
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(count_reader_contract.id(), tx_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await.unwrap();
    sleep(Duration::from_secs(5)).await;
    client.sync_state().await.unwrap();

    // Retrieve final state to confirm the count was copied.
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let account_1 = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "counter contract storage: {:?}",
        account_1.storage().get_item(&counter_slot_name)
    );

    let account_2 = client
        .get_account(count_reader_contract.id())
        .await
        .unwrap()
        .expect("count reader contract not found");
    println!(
        "count reader contract storage: {:?}",
        account_2.storage().get_item(&count_reader_slot_name)
    );
    assert_eq!(
        account_2
            .storage()
            .get_item(&count_reader_slot_name)
            .unwrap(),
        account_1.storage().get_item(&counter_slot_name).unwrap(),
        "FPI must copy the current counter value",
    );

    Ok(())
}
```

Run the standalone project with `TUTORIAL_NETWORK=testnet cargo run --release`. With `MIDEN_COUNTER_ACCOUNT_ID` set, the output shows the reader being created, the counter imported from testnet, and both storage slots containing the same count after the FPI transaction is confirmed. The final assertion assumes the counter is not concurrently incremented while the example runs; use a fresh counter for this check.

### Running the example

To run the checked-in example, return to the root of the [tutorials repository](https://github.com/0xMiden/tutorials/) and run:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin counter_contract_fpi -- "$MIDEN_COUNTER_ACCOUNT_ID"
```

If `MIDEN_COUNTER_ACCOUNT_ID` is exported in your shell, you can omit `--` and the final argument.

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](unauthenticated_note_how_to.md)
