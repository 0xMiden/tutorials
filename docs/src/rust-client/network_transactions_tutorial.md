---
title: "Network Transactions on Miden"
sidebar_position: 6
---

# Network Transactions on Miden

_Using the Miden client in Rust to deploy and interact with smart contracts using network transactions_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v017-examples).

## Overview

In this tutorial, we will explore Network Transactions (NTXs) on Miden - a powerful feature that enables autonomous smart contract execution and public shared state management. Unlike local transactions that require users to execute and prove, network transactions are executed and proven by a network transaction builder.

We'll build a public network counter using the same MASM code as the regular counter. `AuthNetworkAccount` configures the note scripts that the network transaction builder may execute, and a fee policy prices those notes. The increment note also carries a `NetworkAccountTarget` attachment identifying its target. See the [account changes migration guide](https://docs.miden.xyz/builder/migration/account-changes).

Deployment and subsequent updates are different operations. On a fee-enabled network, consuming the initial native-asset funding note publishes the new network account with count **0**. After publication, the public RPC rejects user-submitted transactions that directly update an existing network account. Alice must publish an increment note from her own account; the network transaction builder consumes it and changes the counter to **1**. This restriction is enforced by the [node's submission handler](https://github.com/0xMiden/node/blob/v0.17.0/crates/rpc/src/server/api/submit_proven_tx.rs#L118).

## What we'll cover

- Understanding Network Transactions and when to use them
- Deploying public smart contracts that the network operator can execute
- Publishing a new network account through its initial funding transaction
- Creating network notes for user interactions
- Validating network transaction results

## Prerequisites

This tutorial assumes you have completed the [counter contract tutorial](counter_contract_tutorial.md) and understand basic Miden assembly.

## What are Network Transactions?

Network transactions are executed and proven by the Miden operator rather than the client. They are useful for:

- **Public shared state**: Multiple users can publish notes targeting the same contract; the network transaction builder orders their execution
- **Autonomous execution**: Smart contracts can execute when conditions are met without user intervention
- **Resource-constrained devices**: Clients that can't generate ZK proofs efficiently
- **AMM applications**: Using network notes, you can build sophisticated AMMs where trades execute automatically

The account state and increment notes in this example are public, so the operator can see the transaction inputs.

## Step 1: Initialize your repository

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-network-transactions
cd miden-network-transactions
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

## Step 2: Set up MASM files

The example reads the counter and note sources from the repository’s `masm/` directory.

### Counter Contract

We'll use the same counter contract MASM code as the regular counter tutorial. The key difference is in the Rust configuration, not the MASM code.

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

### Initial deployment

Creating an account locally does not publish it. The funding helper below creates
the new account's first committed transaction by consuming its native-asset note.
No separate increment transaction script is needed on a fee-enabled network. The
empty deployment request shown later is only for networks with zero fees, where
funding does not perform that initial transaction.

### Network Note for User Interaction

The increment note is defined in `masm/notes/network_increment_note.masm`. Note scripts are compiled as libraries; the `@note_script` attribute marks the entrypoint procedure.

```masm
use external_contract::counter_contract

#! Increments the network counter when this note is consumed.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused note script arguments.
#!
#! Invocation: dyncall
@note_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    call.counter_contract::increment_count
    # => [pad(16)]
end
```

After deployment, users will interact with the contract through these network notes.

## Step 3: Initialize the client and create a user account

Before deploying the network account and creating network notes, we need to set up the client and create a user account that will interact with our network contract.

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use rust_client::TutorialClientExt;
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

use miden_client::{
    Client, ClientError, Felt, Word,
    account::{
        AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
        component::{
            AccountComponentMetadata, AuthNetworkAccount, BasicConstantFeePolicy, BasicWallet,
            FeePolicy, FeePolicyManager,
        },
    },
    asset::AssetAmount,
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    rng::draw_word,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, P2idNote, PartialNoteMetadata,
    },
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{ExpirationTransactionScript, TransactionId, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};
use tokio::time::{Duration, sleep};

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    rust_client::wait_for_transaction(client, tx_id).await
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    let fee_faucet_id = fee_config.native_fee_faucet_id();

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
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    // Add the account to the client
    client.add_account(&alice_account, false).await?;

    // Add the key pair to the keystore
    keystore
        .add_key(&key_pair, alice_account.id())
        .await
        .unwrap();
    fund_account_for_fees(&mut client, alice_account.id(), &fee_config).await?;

    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(network.network_id())
    );

    Ok(())
}
```

This step initializes the Miden client and creates a basic user account (Alice) that will interact with our network contract.

## Step 4: Create the network counter smart contract

Build a public account with `AuthNetworkAccount`, the counter component, and
`BasicWallet`. Compile the increment note first so its root can be allowlisted.
Also allow the P2ID funding note. Use `AuthNetworkAccount::custom` for this minimal
account and explicitly allow `ExpirationTransactionScript::script_root()`, which
the network builder uses. No configuration or sponsorship note scripts are
enabled: this account does not implement their required authority components.
There is no custom increment transaction script to allowlist. The zero per-note
policy charge does not remove the network's verification fee: the account pays
that fee from its funded native-asset balance.

Insert this code inside `main`, immediately before its final `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Create Network Counter Smart Contract
// -------------------------------------------------------------------------
println!("\n[STEP 2] Creating a network counter smart contract");

// Read the MASM source from the tutorials repository.
let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();
let network_note_code =
    std::fs::read_to_string("../tutorials/masm/notes/network_increment_note.masm").unwrap();

// An account is a *network account* (one the network
// transaction builder executes on a user's behalf) if and only if it is
// public AND carries the `AuthNetworkAccount` auth component. That component
// holds an allowlist of note scripts the network builder may execute.
// Compile the increment note first so its root can be included at creation.
let note_script = client
    .code_builder()
    .with_linked_module("external_contract::counter_contract", &counter_code)?
    .compile_note_script(&network_note_code)?;
let note_script_root = note_script.root();

// Compile the counter MASM into an account component
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let component_code = client
    .code_builder()
    .compile_component_code("external_contract::counter_contract", &counter_code)?;
let counter_component = AccountComponent::new(
    component_code,
    vec![StorageSlot::with_value(
        counter_slot_name.clone(),
        [Felt::new_unchecked(0); 4].into(),
    )],
    AccountComponentMetadata::new("external_contract::counter_contract"),
)?;

// Generate a random seed for the account
let mut init_seed = [0_u8; 32];
client.rng().fill_bytes(&mut init_seed);

// Build the public network account with the increment and funding notes allowed.
let fee_policy: FeePolicy = BasicConstantFeePolicy::new()
    .with_fees(
        [note_script_root, P2idNote::script_root()].map(|root| (root, AssetAmount::ZERO)),
    )
    .into();
let fee_policy_manager = FeePolicyManager::builder()
    .fee_faucet_id(fee_faucet_id)
    .active_fee_policy(fee_policy)
    .build();
// Match the protocol/node counter example: only permit the two note scripts
// this account implements. Config notes need Authority, which it does not have.
// The canonical expiration script is required by the network builder.
let network_auth = AuthNetworkAccount::custom(
    BTreeSet::from([note_script_root, P2idNote::script_root()]),
    fee_policy_manager,
)?
.with_allowed_tx_scripts([ExpirationTransactionScript::script_root()]);
let counter_contract = AccountBuilder::new(init_seed)
    .account_type(AccountType::Public)
    .with_components(network_auth)
    .with_component(counter_component)
    .with_component(BasicWallet)
    .build()
    .unwrap();

client.add_account(&counter_contract, false).await.unwrap();
fund_account_for_fees(&mut client, counter_contract.id(), &fee_config).await?;

println!(
    "contract id: {:?}",
    counter_contract.id().to_bech32(network.network_id())
);
```

This step creates and funds a public network account. On a fee-enabled network,
the funding transaction also publishes it. Its counter remains zero.

## Step 5: Confirm publication of the network account

When fees are active, initial funding has already published the network account. Do not send
another direct increment transaction from the user client: the node rejects
user-submitted updates to existing network accounts. Only the zero-fee path needs
an explicit first deployment transaction here.

Insert this code after account creation, inside `main` and before `Ok(())`:

```rust ignore
// -------------------------------------------------------------------------
// STEP 3: Publish the network account
// -------------------------------------------------------------------------
println!("\n[STEP 3] Deploy network counter smart contract");

// On a fee-enabled network, consuming the funding note already published this
// account. RPC permits users to deploy new network accounts, but rejects
// user-submitted transactions for existing ones. Subsequent increments must
// be requested by notes and executed by the network transaction builder.
if !fee_config.fees_are_active() {
    let deployment = TransactionRequestBuilder::new().build()?;
    client
        .submit_tutorial_transaction(counter_contract.id(), deployment)
        .await?;
}
println!("Network counter deployed; initial count is 0");
```

The initial committed count is zero. All later counter updates go through network
notes executed by the network transaction builder.

## Step 6: Create a network note for user interaction

Alice publishes a public increment note from her own funded account. The network
transaction builder then consumes that note on the counter's behalf, changing
the counter from zero to one. Confirmation of Alice's transaction alone is not
enough; the example also waits for the counter's updated state.

Replace the final `Ok(())` in `main` with the following fragment. Its polling loop and final `Err(...)` expressions provide the function's result:

```rust ignore
// -------------------------------------------------------------------------
// STEP 4: Prepare & Create the Network Note
// -------------------------------------------------------------------------
println!("\n[STEP 4] Creating a network note for network counter contract");

// Create and submit the network note that will increment the counter
// Generate a random serial number for the note
let serial_num = draw_word(client.rng());

// Reuse the `note_script` compiled in STEP 2 (its root is allowlisted on the
// account, so the network transaction builder will execute this note).
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
    .submit_tutorial_transaction(alice_account.id(), note_req)
    .await?;

println!(
    "View transaction on MidenScan: {}/tx/{:?}",
    network.explorer_url(),
    note_tx_id
);

client.sync_state().await?;

println!("network increment note creation tx submitted, waiting for onchain commitment");

// Wait for the note transaction to be committed
wait_for_tx(&mut client, note_tx_id).await.unwrap();

// Waiting for network note to be picked up by the network transaction builder
sleep(Duration::from_secs(6)).await;

let mut last_val = None;
for _ in 0..24 {
    client.sync_state().await?;

    // Checking updated state
    let new_account_state = client.get_account(counter_contract.id()).await.unwrap();

    if let Some(account) = new_account_state.as_ref() {
        let count: Word = account
            .storage()
            .get_item(&counter_slot_name)
            .unwrap()
            .into();
        let val = count[0].as_canonical_u64();
        if val == 1 {
            println!("🔢 Final counter value: {}", val);
            return Ok(());
        }
        last_val = Some(val);
    }

    // Give the network note builder time to process the note.
    sleep(Duration::from_secs(6)).await;
}

// The network note was submitted, but it is executed asynchronously by the
// network transaction builder. If the counter has not reached 1 within the
// polling window, the tutorial's final state is unconfirmed, so fail rather
// than claim success.
if let Some(val) = last_val {
    Err(format!(
        "Counter did not reach the expected value 1 within the timeout (last observed {}). \
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

## Complete example

Your complete `src/main.rs` file should look like this:

```rust no_run
use rust_client::TutorialClientExt;
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

use miden_client::{
    Client, ClientError, Felt, Word,
    account::{
        AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
        component::{
            AccountComponentMetadata, AuthNetworkAccount, BasicConstantFeePolicy, BasicWallet,
            FeePolicy, FeePolicyManager,
        },
    },
    asset::AssetAmount,
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    rng::draw_word,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, P2idNote, PartialNoteMetadata,
    },
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{ExpirationTransactionScript, TransactionId, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};
use tokio::time::{Duration, sleep};

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    rust_client::wait_for_transaction(client, tx_id).await
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    let fee_faucet_id = fee_config.native_fee_faucet_id();

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
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    // Add the account to the client
    client.add_account(&alice_account, false).await?;

    // Add the key pair to the keystore
    keystore
        .add_key(&key_pair, alice_account.id())
        .await
        .unwrap();
    fund_account_for_fees(&mut client, alice_account.id(), &fee_config).await?;

    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(network.network_id())
    );

    // -------------------------------------------------------------------------
    // STEP 2: Create Network Counter Smart Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Creating a network counter smart contract");

    // Read the MASM source from the tutorials repository.
    let counter_code = std::fs::read_to_string("../tutorials/masm/accounts/counter.masm").unwrap();
    let network_note_code =
        std::fs::read_to_string("../tutorials/masm/notes/network_increment_note.masm").unwrap();

    // An account is a *network account* (one the network
    // transaction builder executes on a user's behalf) if and only if it is
    // public AND carries the `AuthNetworkAccount` auth component. That component
    // holds an allowlist of note scripts the network builder may execute.
    // Compile the increment note first so its root can be included at creation.
    let note_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", &counter_code)?
        .compile_note_script(&network_note_code)?;
    let note_script_root = note_script.root();

    // Compile the counter MASM into an account component
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let component_code = client
        .code_builder()
        .compile_component_code("external_contract::counter_contract", &counter_code)?;
    let counter_component = AccountComponent::new(
        component_code,
        vec![StorageSlot::with_value(
            counter_slot_name.clone(),
            [Felt::new_unchecked(0); 4].into(),
        )],
        AccountComponentMetadata::new("external_contract::counter_contract"),
    )?;

    // Generate a random seed for the account
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Build the public network account with the increment and funding notes allowed.
    let fee_policy: FeePolicy = BasicConstantFeePolicy::new()
        .with_fees(
            [note_script_root, P2idNote::script_root()].map(|root| (root, AssetAmount::ZERO)),
        )
        .into();
    let fee_policy_manager = FeePolicyManager::builder()
        .fee_faucet_id(fee_faucet_id)
        .active_fee_policy(fee_policy)
        .build();
    // Match the protocol/node counter example: only permit the two note scripts
    // this account implements. Config notes need Authority, which it does not have.
    // The canonical expiration script is required by the network builder.
    let network_auth = AuthNetworkAccount::custom(
        BTreeSet::from([note_script_root, P2idNote::script_root()]),
        fee_policy_manager,
    )?
    .with_allowed_tx_scripts([ExpirationTransactionScript::script_root()]);
    let counter_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_components(network_auth)
        .with_component(counter_component)
        .with_component(BasicWallet)
        .build()
        .unwrap();

    client.add_account(&counter_contract, false).await.unwrap();
    fund_account_for_fees(&mut client, counter_contract.id(), &fee_config).await?;

    println!(
        "contract id: {:?}",
        counter_contract.id().to_bech32(network.network_id())
    );

    // -------------------------------------------------------------------------
    // STEP 3: Publish the network account
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Deploy network counter smart contract");

    // On a fee-enabled network, consuming the funding note already published this
    // account. RPC permits users to deploy new network accounts, but rejects
    // user-submitted transactions for existing ones. Subsequent increments must
    // be requested by notes and executed by the network transaction builder.
    if !fee_config.fees_are_active() {
        let deployment = TransactionRequestBuilder::new().build()?;
        client
            .submit_tutorial_transaction(counter_contract.id(), deployment)
            .await?;
    }
    println!("Network counter deployed; initial count is 0");

    // -------------------------------------------------------------------------
    // STEP 4: Prepare & Create the Network Note
    // -------------------------------------------------------------------------
    println!("\n[STEP 4] Creating a network note for network counter contract");

    // Create and submit the network note that will increment the counter
    // Generate a random serial number for the note
    let serial_num = draw_word(client.rng());

    // Reuse the `note_script` compiled in STEP 2 (its root is allowlisted on the
    // account, so the network transaction builder will execute this note).
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
        .submit_tutorial_transaction(alice_account.id(), note_req)
        .await?;

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        note_tx_id
    );

    client.sync_state().await?;

    println!("network increment note creation tx submitted, waiting for onchain commitment");

    // Wait for the note transaction to be committed
    wait_for_tx(&mut client, note_tx_id).await.unwrap();

    // Waiting for network note to be picked up by the network transaction builder
    sleep(Duration::from_secs(6)).await;

    let mut last_val = None;
    for _ in 0..24 {
        client.sync_state().await?;

        // Checking updated state
        let new_account_state = client.get_account(counter_contract.id()).await.unwrap();

        if let Some(account) = new_account_state.as_ref() {
            let count: Word = account
                .storage()
                .get_item(&counter_slot_name)
                .unwrap()
                .into();
            let val = count[0].as_canonical_u64();
            if val == 1 {
                println!("🔢 Final counter value: {}", val);
                return Ok(());
            }
            last_val = Some(val);
        }

        // Give the network note builder time to process the note.
        sleep(Duration::from_secs(6)).await;
    }

    // The network note was submitted, but it is executed asynchronously by the
    // network transaction builder. If the counter has not reached 1 within the
    // polling window, the tutorial's final state is unconfirmed, so fail rather
    // than claim success.
    if let Some(val) = last_val {
        Err(format!(
            "Counter did not reach the expected value 1 within the timeout (last observed {}). \
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

For the standalone Cargo project, run `TUTORIAL_NETWORK=testnet cargo run --release` from `miden-network-transactions`.

To run the checked-in example from the repository root:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin network_notes_counter_contract
```

Successful output has this shape (abridged; IDs and block numbers vary):

```text
Latest block: <block_number>

[STEP 1] Creating a new account for Alice
Alice's account ID: "<testnet_account_id>"

[STEP 2] Creating a network counter smart contract
contract id: "<testnet_account_id>"

[STEP 3] Deploy network counter smart contract
Network counter deployed; initial count is 0

[STEP 4] Creating a network note for network counter contract
View transaction on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>
network increment note creation tx submitted, waiting for onchain commitment
🔢 Final counter value: 1
```

## Summary

Network transactions on Miden enable powerful use cases by allowing the operator to execute transactions on behalf of users. The key steps are:

1. **Create user account**: Standard account creation for interaction
2. **Create network account**: Build a public account with `AuthNetworkAccount`, allowlisting the increment and funding note scripts
3. **Publish and fund it**: The initial native-asset consumption transaction registers the new account with count zero
4. **Interact with network notes**: Users create public notes that the operator executes

The same MASM code works for both regular and network contracts — the difference is purely in the Rust configuration (the `AuthNetworkAccount` auth component and its allowlists). This makes network transactions a powerful tool for building applications like AMMs where multiple users need to interact with shared state efficiently.

### Continue learning

Next tutorial: [How To Create Notes with Custom Logic](custom_note_how_to.md)
