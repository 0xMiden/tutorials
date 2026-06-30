---
title: "Network Transactions on Miden"
sidebar_position: 6
---

# Network Transactions on Miden

_Using the Miden client in Rust to deploy and interact with smart contracts using network transactions_

## Overview

In this tutorial, we will explore Network Transactions (NTXs) on Miden - a powerful feature that enables autonomous smart contract execution and public shared state management. Unlike local transactions that require users to execute and prove, network transactions are executed and proven by a network transaction builder.

We'll build a network counter smart contract using the same MASM code as the regular counter. In v0.15 there is no separate network storage mode: the contract is a public account (`AccountType::Public`), and network execution is triggered by targeting it from a note that carries a `NetworkAccountTarget` attachment.

## What we'll cover

- Understanding Network Transactions and when to use them
- Deploying public smart contracts that the network operator can execute
- Using transaction scripts to initialize network contracts on-chain
- Creating network notes for user interactions
- Validating network transaction results

## Prerequisites

This tutorial assumes you have completed the [counter contract tutorial](counter_contract_tutorial.md) and understand basic Miden assembly.

## What are Network Transactions?

Network transactions are executed and proven by the Miden operator rather than the client. They are useful for:

- **Public shared state**: Multiple users can interact with the same contract state without race conditions
- **Autonomous execution**: Smart contracts can execute when conditions are met without user intervention
- **Resource-constrained devices**: Clients that can't generate ZK proofs efficiently
- **AMM applications**: Using network notes, you can build sophisticated AMMs where trades execute automatically

The main trade-off is reduced privacy since the operator can see transaction inputs.

## Step 1: Initialize your repository

Create a new Rust repository for your Miden project and navigate to it:

```bash
cargo new miden-network-transactions
cd miden-network-transactions
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
miden-client = { version = "0.15", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "0.15", package = "miden-client-sqlite-store" }
miden-protocol = { version = "0.15" }
rand = { version = "0.9" }
tokio = { version = "1.46", features = ["rt-multi-thread", "net", "macros", "fs"] }
```

## Step 2: Set up MASM files

Create the directory structure:

```bash
mkdir -p masm/accounts masm/scripts masm/notes
```

### Counter Contract

We'll use the same counter contract MASM code as the regular counter tutorial. The key difference is in the Rust configuration, not the MASM code.

Create `masm/accounts/counter.masm`:

```masm
use miden::protocol::active_account
use miden::protocol::native_account
use miden::core::word
use miden::core::sys

const COUNTER_SLOT = word("miden::tutorials::counter")

#! Inputs:  []
#! Outputs: [count]
pub proc get_count
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [count]

    exec.sys::truncate_stack
    # => [count]
end

#! Inputs:  []
#! Outputs: []
pub proc increment_count
    push.COUNTER_SLOT[0..2] exec.active_account::get_item
    # => [count]

    add.1
    # => [count+1]

    push.COUNTER_SLOT[0..2] exec.native_account::set_item
    # => []

    exec.sys::truncate_stack
    # => []
end
```

### Transaction Script for Deployment

Create `masm/scripts/counter_script.masm`:

```masm
use external_contract::counter_contract

begin
    call.counter_contract::increment_count
end
```

This script executes a function call (increment) that creates a necessary state change for our contract to be deployed and stored on the network on-chain. In Miden, public contracts must have their state modified through a transaction to be properly registered and committed to the blockchain - simply creating the account isn't sufficient.

### Network Note for User Interaction

Create `masm/notes/network_increment_note.masm`. Note scripts are compiled as libraries; the `@note_script` attribute marks the entrypoint procedure.

```masm
use external_contract::counter_contract

#! Inputs:  []
#! Outputs: []
@note_script
pub proc main
    call.counter_contract::increment_count
end
```

After deployment, users will interact with the contract through these network notes.

## Step 3: Initialize the client and create a user account

Before deploying the network account and creating network notes, we need to set up the client and create a user account that will interact with our network contract.

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{AccountComponentMetadata, BasicWallet}, AccountBuilder, AccountComponent,
        AccountType, StorageSlot, StorageSlotName,
    },
    address::NetworkId,
    auth::{self, AuthSchemeId, AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    crypto::FeltRng,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, PartialNoteMetadata,
    },
    rpc::{Endpoint, GrpcClient},
    store::TransactionFilter,
    transaction::{TransactionId, TransactionRequestBuilder, TransactionStatus},
    Client, ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use tokio::time::{sleep, Duration};

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    loop {
        client.sync_state().await?;

        // Check transaction status
        let txs = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        let tx_committed = if !txs.is_empty() {
            matches!(txs[0].status, TransactionStatus::Committed { .. })
        } else {
            false
        };

        if tx_committed {
            println!("✅ transaction {} committed", tx_id.to_hex());
            break;
        }

        println!(
            "Transaction {} not yet committed. Waiting...",
            tx_id.to_hex()
        );
        sleep(Duration::from_secs(2)).await;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize client
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Initialize keystore
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

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);

    // -------------------------------------------------------------------------
    // STEP 1: Create Basic User Account
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating a new account for Alice");

    // Account seed
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    // Build the account
    let alice_account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_auth_component(AuthSingleSig::new(key_pair.public_key().to_commitment(), AuthSchemeId::Falcon512Poseidon2))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    // Add the account to the client
    client.add_account(&alice_account, false).await?;

    // Add the key pair to the keystore
    keystore.add_key(&key_pair, alice_account.id()).await.unwrap();

    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(NetworkId::Testnet)
    );

    Ok(())
}
```

This step initializes the Miden client and creates a basic user account (Alice) that will interact with our network contract.

## Step 4: Create the network counter smart contract

Now we'll create a network smart contract. It is built as a public account (`AccountType::Public`), just like any other public contract; what makes it network-executable is that notes target it with a `NetworkAccountTarget` attachment (see Step 6).

Add this code to your `main()` function:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Create Network Counter Smart Contract
// -------------------------------------------------------------------------
println!("\n[STEP 2] Creating a network counter smart contract");

// `include_str!` resolves at compile time relative to this source file,
// so the binary is independent of the working directory it is run from.
let counter_code = include_str!("../masm/accounts/counter.masm");

// Create the network counter smart contract account
// First, compile the MASM code into an account component
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let component_code = client
    .code_builder()
    .compile_component_code("external_contract::counter_contract", counter_code)
    .unwrap();
let counter_component = AccountComponent::new(
    component_code,
    vec![StorageSlot::with_value(counter_slot_name.clone(), [Felt::new_unchecked(0); 4].into())], // Initialize counter storage to 0
    AccountComponentMetadata::new("external_contract::counter_contract"),
)
.unwrap();

// Generate a random seed for the account
let mut init_seed = [0_u8; 32];
client.rng().fill_bytes(&mut init_seed);

// Build the immutable network account with no authentication
let counter_contract = AccountBuilder::new(init_seed)
    .account_type(AccountType::Public) // Public, network-executable account
    .with_auth_component(auth::NoAuth) // No authentication required
    .with_component(counter_component)
    .build()
    .unwrap();

client.add_account(&counter_contract, false).await.unwrap();

println!(
    "contract id: {:?}",
    counter_contract.id().to_bech32(NetworkId::Testnet)
);
```

This step creates a public smart contract (`AccountType::Public`) that the network operator can execute once a note targets it with a `NetworkAccountTarget` attachment.

## Step 5: Deploy the network account with a transaction script

We use a transaction script to deploy the network account and ensure it's properly registered on-chain. The script calls the `increment` function, which initializes the counter to 1.

Add this code to your `main()` function:

```rust ignore
// -------------------------------------------------------------------------
// STEP 3: Deploy Network Account with Transaction Script
// -------------------------------------------------------------------------
println!("\n[STEP 3] Deploy network counter smart contract");

let script_code = include_str!("../masm/scripts/counter_script.masm");

// Link the counter contract code into the same `CodeBuilder` chain that
// compiles the script.
let tx_script = client
    .code_builder()
    .with_linked_module("external_contract::counter_contract", counter_code)?
    .compile_tx_script(script_code)?;

let tx_increment_request = TransactionRequestBuilder::new()
    .custom_script(tx_script)
    .build()
    .unwrap();

let tx_id = client
    .submit_new_transaction(counter_contract.id(), tx_increment_request)
    .await
    .unwrap();

println!(
    "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
    tx_id
);

// Wait for the transaction to be committed
wait_for_tx(&mut client, tx_id).await.unwrap();
```

This step uses a transaction script to deploy the network account and ensure it's properly registered on-chain. The script calls the `increment` function, which initializes the counter to 1.

## Step 6: Create a network note for user interaction

We create a public note that the network operator can consume to execute the increment function. This increments the counter from 1 to 2.

Add this code to your `main()` function:

```rust ignore
// -------------------------------------------------------------------------
// STEP 4: Prepare & Create the Network Note
// -------------------------------------------------------------------------
println!("\n[STEP 4] Creating a network note for network counter contract");

let network_note_code = include_str!("../masm/notes/network_increment_note.masm");

// Create and submit the network note that will increment the counter
// Generate a random serial number for the note
let serial_num = client.rng().draw_word();

// Compile the note script with the counter contract code linked as a
// module on the same `CodeBuilder` chain.
let note_script = client
    .code_builder()
    .with_linked_module("external_contract::counter_contract", counter_code)?
    .compile_note_script(network_note_code)?;

// Create note recipient with empty storage
let note_storage = NoteStorage::new([].to_vec())?;
let recipient = NoteRecipient::new(serial_num, note_script, note_storage);

// Set up note metadata - tag it with the counter contract ID so it gets consumed
let tag = NoteTag::with_account_target(counter_contract.id());
let attachment = NetworkAccountTarget::new(counter_contract.id(), NoteExecutionHint::Always)
    .map_err(|e| NoteError::other(e.to_string()))?
    .into();
let metadata = PartialNoteMetadata::new(alice_account.id(), NoteType::Public).with_tag(tag);
let attachments = NoteAttachments::new(vec![attachment]).unwrap();

// Create the complete note
let increment_note =
    Note::with_attachments(NoteAssets::default(), metadata, recipient, attachments);

// Build and submit the transaction containing the note
let note_req = TransactionRequestBuilder::new()
    .own_output_notes(vec![increment_note])
    .build()?;

let note_tx_id = client
    .submit_new_transaction(alice_account.id(), note_req)
    .await?;

println!(
    "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
    note_tx_id
);

client.sync_state().await?;

println!("network increment note creation tx submitted, waiting for onchain commitment");

// Wait for the note transaction to be committed
wait_for_tx(&mut client, note_tx_id).await.unwrap();

// Waiting for network note to be picked up by the network transaction builder
sleep(Duration::from_secs(6)).await;

client.sync_state().await?;

let mut last_val = None;
for _ in 0..10 {
    client.sync_state().await?;

    // Checking updated state
    let new_account_state = client.get_account(counter_contract.id()).await.unwrap();

    if let Some(account) = new_account_state.as_ref() {
        let count: Word = account.storage().get_item(&counter_slot_name).unwrap().into();
        let val = count[0].as_canonical_u64();
        if val >= 2 {
            println!("🔢 Final counter value: {}", val);
            return Ok(());
        }
        last_val = Some(val);
    }

    // Give the network note builder time to process the note.
    sleep(Duration::from_secs(6)).await;
}

// The network note is executed asynchronously by the network transaction builder.
// If the counter has not reached 2 within the polling window, the final state is
// unconfirmed, so return an error rather than claim success.
if let Some(val) = last_val {
    Err(format!(
        "Counter did not reach the expected value 2 within the timeout (last observed {}). \
         The network note was submitted but its execution is still pending on the network \
         transaction builder; re-run or check Midenscan.",
        val
    )
    .into())
} else {
    Err("Counter state was not available within the timeout; the network note execution is still pending."
        .into())
}
```

This step creates a public note that the network operator can consume to execute the increment function. This increments the counter from 1 to 2.

## Summary

Your complete `main()` function should look like this:

```rust no_run
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{AccountComponentMetadata, BasicWallet}, AccountBuilder, AccountComponent,
        AccountType, StorageSlot, StorageSlotName,
    },
    address::NetworkId,
    auth::{self, AuthSchemeId, AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    crypto::FeltRng,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, PartialNoteMetadata,
    },
    rpc::{Endpoint, GrpcClient},
    store::TransactionFilter,
    transaction::{TransactionId, TransactionRequestBuilder, TransactionStatus},
    Client, ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use tokio::time::{sleep, Duration};

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    loop {
        client.sync_state().await?;

        // Check transaction status
        let txs = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        let tx_committed = if !txs.is_empty() {
            matches!(txs[0].status, TransactionStatus::Committed { .. })
        } else {
            false
        };

        if tx_committed {
            println!("✅ transaction {} committed", tx_id.to_hex());
            break;
        }

        println!(
            "Transaction {} not yet committed. Waiting...",
            tx_id.to_hex()
        );
        sleep(Duration::from_secs(2)).await;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize client
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Initialize keystore
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

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);

    // -------------------------------------------------------------------------
    // STEP 1: Create Basic User Account
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating a new account for Alice");

    // Account seed
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    // Build the account
    let alice_account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_auth_component(AuthSingleSig::new(key_pair.public_key().to_commitment(), AuthSchemeId::Falcon512Poseidon2))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    // Add the account to the client
    client.add_account(&alice_account, false).await?;

    // Add the key pair to the keystore
    keystore.add_key(&key_pair, alice_account.id()).await.unwrap();

    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(NetworkId::Testnet)
    );

    // -------------------------------------------------------------------------
    // STEP 2: Create Network Counter Smart Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Creating a network counter smart contract");

    // `include_str!` resolves at compile time relative to this source file,
    // so the binary is independent of the working directory it is run from.
    let counter_code = include_str!("../masm/accounts/counter.masm");

    // Create the network counter smart contract account
    // First, compile the MASM code into an account component
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let component_code = client
        .code_builder()
        .compile_component_code("external_contract::counter_contract", counter_code)
        .unwrap();
    let counter_component = AccountComponent::new(
        component_code,
        vec![StorageSlot::with_value(counter_slot_name.clone(), [Felt::new_unchecked(0); 4].into())], // Initialize counter storage to 0
        AccountComponentMetadata::new("external_contract::counter_contract"),
    )
    .unwrap();

    // Generate a random seed for the account
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Build the immutable network account with no authentication
    let counter_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public) // Public, network-executable account
        .with_auth_component(auth::NoAuth) // No authentication required
        .with_component(counter_component)
        .build()
        .unwrap();

    client.add_account(&counter_contract, false).await.unwrap();

    println!(
        "contract id: {:?}",
        counter_contract.id().to_bech32(NetworkId::Testnet)
    );

    // -------------------------------------------------------------------------
    // STEP 3: Deploy Network Account with Transaction Script
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Deploy network counter smart contract");

    let script_code = include_str!("../masm/scripts/counter_script.masm");

    // Link the counter contract code into the same `CodeBuilder` chain that
    // compiles the script.
    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)?
        .compile_tx_script(script_code)?;

    let tx_increment_request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_new_transaction(counter_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    // Wait for the transaction to be committed
    wait_for_tx(&mut client, tx_id).await.unwrap();

    // -------------------------------------------------------------------------
    // STEP 4: Prepare & Create the Network Note
    // -------------------------------------------------------------------------
    println!("\n[STEP 4] Creating a network note for network counter contract");

    let network_note_code = include_str!("../masm/notes/network_increment_note.masm");

    // Create and submit the network note that will increment the counter
    // Generate a random serial number for the note
    let serial_num = client.rng().draw_word();

    // Compile the note script with the counter contract code linked as a
    // module on the same `CodeBuilder` chain.
    let note_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)?
        .compile_note_script(network_note_code)?;

    // Create note recipient with empty inputs
    let note_storage = NoteStorage::new([].to_vec())?;
    let recipient = NoteRecipient::new(serial_num, note_script, note_storage);

    // Set up note metadata - tag it with the counter contract ID so it gets consumed
    let tag = NoteTag::with_account_target(counter_contract.id());
    let attachment = NetworkAccountTarget::new(counter_contract.id(), NoteExecutionHint::Always)
        .map_err(|e| NoteError::other(e.to_string()))?
        .into();
    let metadata = PartialNoteMetadata::new(alice_account.id(), NoteType::Public).with_tag(tag);
    let attachments = NoteAttachments::new(vec![attachment]).unwrap();

    // Create the complete note
    let increment_note =
        Note::with_attachments(NoteAssets::default(), metadata, recipient, attachments);

    // Build and submit the transaction containing the note
    let note_req = TransactionRequestBuilder::new()
        .own_output_notes(vec![increment_note])
        .build()?;

    let note_tx_id = client
        .submit_new_transaction(alice_account.id(), note_req)
        .await?;

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        note_tx_id
    );

    client.sync_state().await?;

    println!("network increment note creation tx submitted, waiting for onchain commitment");

    // Wait for the note transaction to be committed
    wait_for_tx(&mut client, note_tx_id).await.unwrap();

    // Waiting for network note to be picked up by the network transaction builder
    sleep(Duration::from_secs(6)).await;

    client.sync_state().await?;

    let mut last_val = None;
    for _ in 0..10 {
        client.sync_state().await?;

        // Checking updated state
        let new_account_state = client.get_account(counter_contract.id()).await.unwrap();

        if let Some(account) = new_account_state.as_ref() {
            let count: Word = account.storage().get_item(&counter_slot_name).unwrap().into();
            let val = count[0].as_canonical_u64();
            if val >= 2 {
                println!("🔢 Final counter value: {}", val);
                return Ok(());
            }
            last_val = Some(val);
        }

        // Give the network note builder time to process the note.
        sleep(Duration::from_secs(6)).await;
    }

    // The network note was submitted, but it is executed asynchronously by the
    // network transaction builder. If the counter has not reached 2 within the
    // polling window, the tutorial's final state is unconfirmed, so fail rather
    // than claim success.
    if let Some(val) = last_val {
        Err(format!(
            "Counter did not reach the expected value 2 within the timeout (last observed {}). \
             The network note was submitted but its execution is still pending on the network \
             transaction builder; re-run or check Midenscan.",
            val
        )
        .into())
    } else {
        Err("Counter state was not available within the timeout; the network note execution is still pending."
            .into())
    }
}
```

## Step 7: Running the Example

To run the complete network transaction example:

```bash
cd rust-client
cargo run --release --bin network_notes_counter_contract
```

Expected output:

```text
Latest block: 4342

[STEP 1] Creating a new account for Alice
Alice's account ID: "mtst1azkn605dchqv7yrd9crnvrkknvw8j4d3"

[STEP 2] Creating a network counter smart contract
contract id: "mtst1ar5dqpk49zjsvsqenfuqzskcvvmf9spc"

[STEP 3] Deploy network counter smart contract
View transaction on MidenScan: https://testnet.midenscan.com/tx/0xe28fa8e527335499d972e653dfd944ad591752e537a41b151e7b80d598c5660c
✅ transaction 0xe28fa8e527335499d972e653dfd944ad591752e537a41b151e7b80d598c5660c committed

[STEP 4] Creating a network note for network counter contract
View transaction on MidenScan: https://testnet.midenscan.com/tx/0x3cd653f2848f2fbc3de76d7b0a92c82d23ad1f9f24c9fb86d58772534e17ee30
network increment note created, waiting for onchain commitment
✅ transaction 0x3cd653f2848f2fbc3de76d7b0a92c82d23ad1f9f24c9fb86d58772534e17ee30 committed
🔢 Final counter value: 2
```

## Summary

Network transactions on Miden enable powerful use cases by allowing the operator to execute transactions on behalf of users. The key steps are:

1. **Create user account**: Standard account creation for interaction
2. **Create network account**: Build a public account (`AccountType::Public`); network execution comes from a `NetworkAccountTarget` attachment on the note
3. **Deploy with transaction script**: Ensures the contract is registered on-chain
4. **Interact with network notes**: Users create public notes that the operator executes

The same MASM code works for both regular and network contracts - the difference is purely in the Rust configuration. This makes network transactions a powerful tool for building applications like AMMs where multiple users need to interact with shared state efficiently.

### Continue learning

Next tutorial: [How To Create Notes with Custom Logic](custom_note_how_to.md)
