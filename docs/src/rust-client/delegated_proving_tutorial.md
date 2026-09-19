---
title: "Delegated Proving"
sidebar_position: 12
---

# Delegated Proving

_Using delegated proving to minimize transaction proving times on computationally constrained devices_

**[View the complete runnable example on GitHub](https://github.com/0xMiden/tutorials/blob/main/rust-client/src/bin/delegated_prover.rs)**

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In this tutorial we will cover how to use delegated proving with the Miden Rust client to minimize the time it takes to generate a valid transaction proof. We create and fund an account, execute a minimal transaction locally, prove it with the network's remote prover, and verify that its confirmed nonce increases by one. Even this minimal transaction pays a verification fee on testnet.

## Prerequisites

This tutorial assumes you have basic familiarity with the Miden Rust client.

## What we'll cover

- Explaining what "delegated proving" is and its pros and cons
- How to use delegated proving with the Rust client

## What is Delegated Proving?

Before diving into our code example, let's clarify what "delegated proving" means.

Delegated proving is the process of outsourcing the ZK proof generation of your transaction to a third party. For certain computationally constrained devices such as mobile phones and web browser environments, generating ZK proofs might take too long to ensure an acceptable user experience. Devices that do not have the computational resources to generate Miden proofs in under 1-2 seconds can use delegated proving to provide a more responsive user experience.

_How does it work?_ When a user chooses to use delegated proving, they send off their locally executed transaction to a dedicated server. This dedicated server generates the ZK proof for the executed transaction and sends the proof back to the user. The transaction proof is verified under the same rules as a locally generated proof: the delegated prover cannot make an invalid state transition valid. This protects transaction integrity, but does not keep the witness private from the prover.

Delegated proving reveals the transaction witness to the prover and depends on that service being available. The witness can include private account state and note arguments. For example, it would not be advisable to use delegated proving in the case of our "How to Create a Custom Note" tutorial, since the note we create requires knowledge of a hash preimage to redeem the assets in the note. Using delegated proving would reveal the hash preimage to the server running the delegated proving service.

Anyone can run their own delegated prover server. If you are building a product on Miden, it may make sense to run your own delegated prover server for your users. To run your own delegated proving server, follow the instructions here: https://crates.io/crates/miden-remote-prover.

This tutorial performs real delegated proving against the public Miden testnet prover at
`https://tx-prover.testnet.miden.io` using `RemoteTransactionProver`. To use your own delegated
prover instead, point `RemoteTransactionProver` at its URL.

## Step 1: Initialize your repository

Start in the directory containing your `tutorials` clone and create a sibling Cargo project. The dependency path below assumes the clone is named `tutorials`.

```bash
cargo new miden-delegated-proving-app
cd miden-delegated-proving-app
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Keep the generated `[package]` section in `Cargo.toml`, replace its empty `[dependencies]` section with the following, and add the development profile:

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

## Step 2: Initialize the client and prover and construct transactions

Similarly to previous tutorials, we must instantiate the client.
We construct a `RemoteTransactionProver` pointed at the public Miden testnet delegated prover for this walkthrough. Copy this complete example into `src/main.rs`. The client creates `store.sqlite3` and `keystore/` in the project directory; keep both out of version control.

```rust no_run
use rand::Rng;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError, RemoteTransactionProver,
    account::{AccountBuilder, AccountType, component::BasicWallet},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{TransactionProver, TransactionRequestBuilder},
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

    // Create Alice's account
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let alice_account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Private)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    client.add_account(&alice_account, false).await?;
    keystore
        .add_key(&key_pair, alice_account.id())
        .await
        .unwrap();
    fund_account_for_fees(&mut client, alice_account.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // Set up the delegated (remote) tx prover
    // -------------------------------------------------------------------------
    // Delegated proving outsources ZK proof generation to a remote service. This is
    // the public prover for the selected network; run your own
    // (https://crates.io/crates/miden-remote-prover) and swap the URL to use it.
    // The upstream constant keeps this URL synchronized with the selected network.
    let remote_tx_prover = RemoteTransactionProver::new(network.remote_prover_url());
    let tx_prover: Arc<dyn TransactionProver> = Arc::new(remote_tx_prover);

    // We use a dummy transaction request to showcase delegated proving.
    // In addition to paying the network fee, this transaction increments Alice's nonce.
    let initial_nonce = client
        .get_account(alice_account.id())
        .await?
        .expect("Alice exists")
        .nonce();
    println!("Alice nonce initial: {:?}", initial_nonce);
    let script_code = "@transaction_script pub proc main push.1 drop end";
    let tx_script = client
        .code_builder()
        .compile_tx_script(script_code)
        .unwrap();

    let transaction_request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .unwrap();

    // Step 1: Execute the transaction locally
    println!("Executing transaction...");
    client.sync_state().await?;
    let tx_result = client
        .execute_transaction(alice_account.id(), transaction_request)
        .await?;

    // Step 2: Prove the transaction using the delegated (remote) prover
    println!("Proving transaction with the delegated prover...");
    let proven_transaction = client.prove_transaction_with(&tx_result, tx_prover).await?;

    // Step 3: Submit the proven transaction
    println!("Submitting proven transaction...");
    let submission_height = client
        .submit_proven_transaction(proven_transaction, &tx_result)
        .await?;

    // Step 4: Apply the transaction to local store
    client
        .apply_transaction(&tx_result, submission_height)
        .await?;
    rust_client::wait_for_transaction(&mut client, tx_result.id()).await?;

    println!("Transaction submitted successfully using the delegated prover!");

    client.sync_state().await.unwrap();

    let account = client
        .get_account(alice_account.id())
        .await
        .unwrap()
        .expect("alice account not found");

    println!("Alice nonce has increased: {:?}", account.nonce());
    assert_eq!(account.nonce(), initial_nonce + miden_client::Felt::ONE);

    Ok(())
}
```

Now let's run the `src/main.rs` program:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

The following is an abbreviated output. The funding transaction has already increased Alice's nonce from 0 to 1; the delegated transaction then increases it to 2:

```text
Latest block: <current_block_number>
Alice nonce initial: 1
Executing transaction...
Proving transaction with the delegated prover...
Submitting proven transaction...
Transaction committed: <transaction_id>
Transaction submitted successfully using the delegated prover!
Alice nonce has increased: 2
```

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin delegated_prover
```

### Continue learning

Next tutorial: [Consuming On-Chain Price Data from the Pragma Oracle](oracle_tutorial.md)
