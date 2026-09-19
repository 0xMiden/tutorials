---
title: "Interacting with Public Smart Contracts"
sidebar_position: 5
---

# Interacting with Public Smart Contracts

_Using the Miden client in Rust to interact with public smart contracts on Miden_

**[View the complete runnable example on GitHub](https://github.com/0xMiden/tutorials/blob/main/rust-client/src/bin/counter_contract_increment.rs)**

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In the previous tutorial, we built a simple counter contract and deployed it to the Miden testnet. However, we only covered how the contract’s deployer could interact with it. Now, let’s explore how anyone can interact with a public smart contract on Miden.

We'll import the counter contract's public state from the chain and execute a local transaction against it. Its `NoAuth` authentication component permits this without a signature; a public account with signature authentication would still require the appropriate authorization. For contracts that should execute autonomously on behalf of users, continue with the network transactions tutorial after this one.

Just like in the previous tutorial, we will use a script to invoke the increment function within the counter contract to update the count. However, this tutorial demonstrates how to call a procedure in a smart contract that was deployed by a different user on Miden.

## What we'll cover

- Reading state from a public smart contract
- Interacting with public smart contracts on Miden

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly and a counter deployed with the code from the previous tutorial. Keep the `mtst1...` account ID printed by that deployment; the standalone program requires it.

The counter deployment example also funds the contract's native fee balance.
This example spends from that existing balance when incrementing the counter;
ensure the imported contract has enough funds. The runner supplies a freshly
deployed, funded counter automatically.

## Step 1: Initialize your repository

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-public-account-interaction
cd miden-public-account-interaction
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
# Clone tutorials next to this Cargo project (see Rust client setup).
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.16.0", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.16.0", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.16.0" }
rand = { version = "0.10" }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

## Step 2: Prepare the counter module and script

The account already exists on-chain. We use the repository’s `masm/accounts/counter.masm` module to link the increment transaction script:

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

The transaction script is defined in `masm/scripts/counter_script.masm`:

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

**Note**: _We explained in the previous counter contract tutorial what exactly happens at each step in the `increment_count` procedure._

## Step 3: Set up your `src/main.rs` file

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError,
    account::{AccountId, StorageSlotName},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::TutorialNetwork;

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

    Ok(())
}
```

## Step 4: Reading public state from a smart contract

This tutorial uses `Client::import_account_by_id` to import a public account from testnet and read its storage. First run the [counter contract tutorial](./counter_contract_tutorial.md), then copy the deployed counter's `mtst1...` account ID. Pass that ID to this program instead of hard-coding an address, because testnet is reset periodically.

Insert the following code inside `main`, immediately before its final `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 1: Read the Public State of the Counter Contract
// -------------------------------------------------------------------------
println!("\n[STEP 1] Reading data from public state");

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
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let count_before = counter_contract
    .storage()
    .get_item(&counter_slot_name)
    .unwrap()[0];
```

Set `MIDEN_COUNTER_ACCOUNT_ID` to the deployed `mtst1...` address in your shell, or replace the quoted variable below with that address. Run the following command to execute `src/main.rs`:

```bash
TUTORIAL_NETWORK=testnet cargo run --release -- "$MIDEN_COUNTER_ACCOUNT_ID"
```

The program prints the imported storage slot. For a freshly deployed counter, the abridged output is:

```text
Account details: StorageSlot { ... content: Value(Word([1, 0, 0, 0])) }
```

## Step 5: Increment the imported counter

Insert the following code after the import step, inside `main` and before `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Call the Counter Contract with a script
// -------------------------------------------------------------------------
println!("\n[STEP 2] Call the increment_count procedure in the counter contract");

// Read the MASM source from the tutorials repository.
let script_code =
    std::fs::read_to_string("../tutorials/masm/scripts/counter_script.masm").unwrap();
let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

// Compile the script with the counter contract code linked as a module
// on the same `CodeBuilder` chain.
let tx_script = client
    .code_builder()
    .with_linked_module("external_contract::counter_contract", &counter_code)
    .unwrap()
    .compile_tx_script(&script_code)
    .unwrap();

// Build a transaction request with the custom script
let tx_increment_request = TransactionRequestBuilder::new()
    .custom_script(tx_script)
    .build()
    .unwrap();

// Execute and submit the transaction
let tx_id = client
    .submit_tutorial_transaction(counter_contract_id, tx_increment_request)
    .await
    .unwrap();

println!(
    "View transaction on MidenScan: {}/tx/{:?}",
    network.explorer_url(),
    tx_id
);

client.sync_state().await.unwrap();

// Retrieve updated contract data to see the incremented counter
let account = client
    .get_account(counter_contract_id)
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "counter contract storage: {:?}",
    account.storage().get_item(&counter_slot_name)
);
assert_eq!(
    account.storage().get_item(&counter_slot_name).unwrap()[0],
    count_before + miden_client::ONE,
    "the imported counter must increment exactly once",
);
```

## Summary

The final `src/main.rs` file should look like this:

```rust no_run
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError,
    account::{AccountId, StorageSlotName},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::TutorialNetwork;

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

    // -------------------------------------------------------------------------
    // STEP 1: Read the Public State of the Counter Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Reading data from public state");

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
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let count_before = counter_contract
        .storage()
        .get_item(&counter_slot_name)
        .unwrap()[0];

    // -------------------------------------------------------------------------
    // STEP 2: Call the Counter Contract with a script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call the increment_count procedure in the counter contract");

    // Read the MASM source from the tutorials repository.
    let script_code =
        std::fs::read_to_string("../tutorials/masm/scripts/counter_script.masm").unwrap();
    let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

    // Compile the script with the counter contract code linked as a module
    // on the same `CodeBuilder` chain.
    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", &counter_code)
        .unwrap()
        .compile_tx_script(&script_code)
        .unwrap();

    // Build a transaction request with the custom script
    let tx_increment_request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .unwrap();

    // Execute and submit the transaction
    let tx_id = client
        .submit_tutorial_transaction(counter_contract_id, tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await.unwrap();

    // Retrieve updated contract data to see the incremented counter
    let account = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "counter contract storage: {:?}",
        account.storage().get_item(&counter_slot_name)
    );
    assert_eq!(
        account.storage().get_item(&counter_slot_name).unwrap()[0],
        count_before + miden_client::ONE,
        "the imported counter must increment exactly once",
    );
    Ok(())
}
```

Run the following command to execute src/main.rs:

```bash
TUTORIAL_NETWORK=testnet cargo run --release -- "$MIDEN_COUNTER_ACCOUNT_ID"
```

The output of our program will look something like this depending on the current count value in the smart contract:

```text
Latest block: <block_number>

[STEP 1] Reading data from public state
Account details: StorageSlot { ... content: Value(Word([1, 0, 0, 0])) }

[STEP 2] Call the increment_count procedure in the counter contract
View transaction on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>
counter contract storage: Ok(Word([2, 0, 0, 0]))
```

### Running the example

To run the checked-in example, return to the root of the [tutorials repository](https://github.com/0xMiden/tutorials/) and run:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin counter_contract_increment -- "$MIDEN_COUNTER_ACCOUNT_ID"
```

If `MIDEN_COUNTER_ACCOUNT_ID` is exported in your shell, you can omit `--` and the final argument.

### Continue learning

Next tutorial: [Network Transactions on Miden](network_transactions_tutorial.md)
