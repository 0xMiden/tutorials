---
title: "Deploying a Counter Contract"
sidebar_position: 4
---

# Deploying a Counter Contract

_Using the Miden client in Rust to deploy and interact with a custom smart contract on Miden_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v017-examples).

## Overview

In this tutorial, we will build a simple counter smart contract that maintains a count, deploy it to Miden testnet, and interact with it by incrementing the count.

Using a script, we will invoke the increment function within the counter contract to update the count. This tutorial provides a foundational understanding of developing and deploying custom smart contracts on Miden.

## What we'll cover

- Deploying a custom smart contract on Miden
- Getting up to speed with the basics of Miden assembly
- Calling procedures in an account
- Read-only vs state-changing procedures

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly. To quickly get up to speed with Miden assembly (MASM), please play around with running basic Miden assembly programs in the [Miden playground](https://0xMiden.github.io/examples/).

## Step 1: Initialize your repository

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-counter-contract
cd miden-counter-contract
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
# Clone tutorials next to this Cargo project (see Rust client setup).
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.17.2", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.17.2", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.17.1" }
rand = { version = "0.10" }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

### Set up your `src/main.rs` file

In the previous section, we explained how to instantiate the Miden client. We reuse that client setup and the shared fee helpers for our counter contract.

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError, Word,
    account::{
        AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
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

    Ok(())
}
```

_When running the code above, there will be some unused imports, however, we will use these imports later on in the tutorial._

**Note**: Running the code above, will generate a `store.sqlite3` file and a `keystore` directory. The Miden client uses the `store.sqlite3` file to keep track of the state of accounts and notes. The `keystore` directory keeps track of private keys used by accounts. Be sure to add both to your `.gitignore`!

## Step 2: Build the counter contract

The account and transaction-script sources are already in the repository. We examine them below before compiling them from Rust.

### Custom Miden smart contract

Below is our counter contract. It has two exported procedures: `get_count` and `increment_count`.

At the beginning of the MASM file, we define our imports. In this case, we import
`miden::protocol::active_account`, `miden::protocol::native_account`, and
`miden::core::sys`.

The `miden::protocol::active_account` and `miden::protocol::native_account` modules contain
procedures for reading and writing contract state. The compile-time expression
`word("miden::tutorials::counter")` derives the named storage slot's ID; `[0..2]`
selects the two elements used by the account storage APIs.

The import `miden::core::sys` contains a useful procedure for truncating the operand stack at the
end of a procedure.

#### Here's a breakdown of what the `get_count` procedure does:

1. Pushes the slot ID prefix and suffix for `miden::tutorials::counter` onto the stack.
2. Calls `active_account::get_item` with the slot ID.
3. Calls `sys::truncate_stack` to truncate the stack to size 16.
4. The value returned from `active_account::get_item` is still on the stack and will be returned
   when this procedure is called.

#### Here's a breakdown of what the `increment_count` procedure does:

1. Pushes the slot ID prefix and suffix for `miden::tutorials::counter` onto the stack.
2. Calls `active_account::get_item` with the slot ID.
3. Pushes `1` onto the stack.
4. Adds `1` to the count value returned from `active_account::get_item`.
5. Pushes the slot ID prefix and suffix again so we can write the updated count.
6. Calls `native_account::set_item` which saves the incremented count to storage.
7. Drops the old storage word returned by `set_item`, then calls `sys::truncate_stack` to clean up the stack.

The counter is defined in `masm/accounts/counter.masm`:

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

**Note**: _It's a good habit to add comments below each line of MASM code with the expected stack state. This improves readability and helps with debugging._

### Authentication Component

Accounts require an authentication component. This public counter deliberately uses `NoAuth`, which pays transaction fees from the account's native-asset balance and updates its nonce without verifying a signature.

This `NoAuth` component allows any user to interact with the smart contract without requiring signature verification.

### Custom script

This is a Miden assembly script that will call the `increment_count` procedure during the transaction.

The Rust code links the counter module as `external_contract::counter_contract`, so the script can call `counter_contract::increment_count` by name.

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

## Step 3: Build the counter smart contract

To build the counter contract, insert the following code inside `main`, immediately before its final `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 1: Create a basic counter contract
// -------------------------------------------------------------------------
println!("\n[STEP 1] Creating counter contract.");

// Read the MASM source from the tutorials repository.
let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

// Compile the account code into `AccountComponent` with one storage slot.
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let component_code = client
    .code_builder()
    .compile_component_code("external_contract::counter_contract", &counter_code)
    .unwrap();
let counter_component = AccountComponent::new(
    component_code,
    vec![StorageSlot::with_value(
        counter_slot_name.clone(),
        Word::default(),
    )],
    AccountComponentMetadata::new("external_contract::counter_contract"),
)
.unwrap();

// Init seed for the counter contract
let mut seed = [0_u8; 32];
client.rng().fill_bytes(&mut seed);

// Build the new `Account` with the component
let counter_contract = AccountBuilder::new(seed)
    .account_type(AccountType::Public)
    .with_component(counter_component.clone())
    .with_component(BasicWallet)
    .with_component(NoAuth)
    .build()
    .unwrap();

println!(
    "counter_contract commitment: {:?}",
    counter_contract.to_commitment()
);
println!("counter_contract id: {:?}", counter_contract.id());
println!("counter_contract storage: {:?}", counter_contract.storage());

client.add_account(&counter_contract, false).await.unwrap();
fund_account_for_fees(&mut client, counter_contract.id(), &fee_config).await?;
```

Run the following command to execute `src/main.rs`:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

After the program executes, it prints the initial account commitment, ID, and storage. Abridged output looks like this; generated values vary:

```text
[STEP 1] Creating counter contract.
counter_contract commitment: Word([...])
counter_contract id: V1(AccountIdV1 { suffix: ..., prefix: ... })
counter_contract storage: AccountStorage { slots: [StorageSlot { ... content: Value(Word([0, 0, 0, 0])) }] }
```

The funding helper then consumes a native-asset note and waits for confirmation. That first transaction publishes the account without incrementing its counter.

## Step 4: Incrementing the count

Now that we have built and funded the counter contract, let's create a transaction request to increment the count:

Insert the following code after the previous step, still inside `main` and before `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Call the Counter Contract with a script
// -------------------------------------------------------------------------
println!("\n[STEP 2] Call Counter Contract With Script");

// Load the MASM script referencing the increment procedure
let script_code =
    std::fs::read_to_string("../tutorials/masm/scripts/counter_script.masm").unwrap();

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
    .submit_tutorial_transaction(counter_contract.id(), tx_increment_request)
    .await
    .unwrap();

println!(
    "View transaction on MidenScan: {}/tx/{:?}",
    network.explorer_url(),
    tx_id
);

println!(
    "Counter contract id: {:?}",
    counter_contract.id().to_bech32(network.network_id())
);

client.sync_state().await.unwrap();

// Retrieve updated contract data to see the incremented counter
let account = client
    .get_account(counter_contract.id())
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "counter contract storage: {:?}",
    account.storage().get_item(&counter_slot_name)
);
assert_eq!(
    account.storage().get_item(&counter_slot_name).unwrap()[0].as_canonical_u64(),
    1,
    "the deployed counter must increment from zero to one",
);
```

Because this counter uses `NoAuth`, another client can import its public state and execute the same increment script. Public visibility alone does not grant that permission; the account's authentication component does.

## Summary

The final `src/main.rs` file should look like this:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError, Word,
    account::{
        AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
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
    // STEP 1: Create a basic counter contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating counter contract.");

    // Read the MASM source from the tutorials repository.
    let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();

    // Compile the account code into `AccountComponent` with one storage slot.
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let component_code = client
        .code_builder()
        .compile_component_code("external_contract::counter_contract", &counter_code)
        .unwrap();
    let counter_component = AccountComponent::new(
        component_code,
        vec![StorageSlot::with_value(
            counter_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::counter_contract"),
    )
    .unwrap();

    // Init seed for the counter contract
    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    // Build the new `Account` with the component
    let counter_contract = AccountBuilder::new(seed)
        .account_type(AccountType::Public)
        .with_component(counter_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "counter_contract commitment: {:?}",
        counter_contract.to_commitment()
    );
    println!("counter_contract id: {:?}", counter_contract.id());
    println!("counter_contract storage: {:?}", counter_contract.storage());

    client.add_account(&counter_contract, false).await.unwrap();
    fund_account_for_fees(&mut client, counter_contract.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // STEP 2: Call the Counter Contract with a script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call Counter Contract With Script");

    // Load the MASM script referencing the increment procedure
    let script_code =
        std::fs::read_to_string("../tutorials/masm/scripts/counter_script.masm").unwrap();

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
        .submit_tutorial_transaction(counter_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    println!(
        "Counter contract id: {:?}",
        counter_contract.id().to_bech32(network.network_id())
    );

    client.sync_state().await.unwrap();

    // Retrieve updated contract data to see the incremented counter
    let account = client
        .get_account(counter_contract.id())
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "counter contract storage: {:?}",
        account.storage().get_item(&counter_slot_name)
    );
    assert_eq!(
        account.storage().get_item(&counter_slot_name).unwrap()[0].as_canonical_u64(),
        1,
        "the deployed counter must increment from zero to one",
    );

    Ok(())
}
```

Successful output includes the following lines (abridged; generated values vary):

```text
Latest block: <block_number>

[STEP 1] Creating counter contract.
counter_contract commitment: Word([...])
counter_contract id: V1(AccountIdV1 { suffix: ..., prefix: ... })
counter_contract storage: AccountStorage { slots: [StorageSlot { ... content: Value(Word([0, 0, 0, 0])) }] }

[STEP 2] Call Counter Contract With Script
View transaction on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>
Counter contract id: "<testnet_account_id>"
counter contract storage: Ok(Word([1, 0, 0, 0]))
```

To increment the contract again without redeploying it, pass the printed testnet account ID to the [public-account interaction tutorial](./public_account_interaction_tutorial.md). Keeping the ID as an input avoids hard-coding an address that becomes invalid after a testnet reset.

### Running the example

To run the checked-in example, return to the root of the [tutorials repository](https://github.com/0xMiden/tutorials/) and run:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin counter_contract_deploy
```

### Continue learning

Next tutorial: [Interacting with Public Smart Contracts](public_account_interaction_tutorial.md)
