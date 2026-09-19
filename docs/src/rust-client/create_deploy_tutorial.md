---
title: "Creating Accounts and Faucets"
sidebar_position: 2
---

# Creating Accounts and Faucets

_Using the Miden client in Rust to create accounts and deploy faucets_

**[View the complete runnable example on GitHub](https://github.com/0xMiden/tutorials/blob/main/rust-client/src/bin/create_mint_consume_send.rs)**

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In this tutorial, we will create a Miden account for _Alice_ and deploy a fungible faucet. In the next section, we will mint tokens from the faucet to fund her account and transfer tokens from Alice's account to other Miden accounts.

## What we'll cover

- Understanding the differences between public and private accounts & notes
- Instantiating the Miden client
- Creating new accounts (public or private)
- Deploying a faucet to fund an account

## Prerequisites

The commands in this guide select the public testnet explicitly. If you change the endpoint to a local node, start that node first by following [Miden Node Setup](../miden_node_setup.md).

## Public vs. private accounts & notes

Before diving into coding, let's clarify the concepts of public and private accounts & notes on Miden:

- Public accounts: The account's data and code are stored on-chain and are openly visible, including its assets.
- Private accounts: Only a commitment to the account state is stored on-chain. The owner keeps the full state locally and may share it with others.
- Public notes: The note's state is visible to anyone - perfect for scenarios where transparency is desired.
- Private notes: The note's state is stored off-chain, you will need to share the note data with the relevant parties (via email or Telegram) for them to be able to consume the note.

Note: _The term "account" can be used interchangeably with the term "smart contract" since account abstraction on Miden is handled natively._

_It is useful to think of notes on Miden as "cryptographic cashier's checks" that allow users to send tokens. Private note details must be shared with the recipient; the chain still records the note commitment and its eventual nullifier._

## Step 1: Initialize your repository

Start in the directory containing your `tutorials` clone and create a sibling Cargo project. The dependency path below assumes the clone is named `tutorials`.

```bash
cargo new miden-rust-client
cd miden-rust-client
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

## Step 2: Initialize the client

Before interacting with the Miden network, we must instantiate the client. In this step, we specify several parameters:

- **RPC endpoint** - The URL of the Miden node you will connect to.
- **Client RNG** - The random number generator used by the client, ensuring that the serial number of newly created notes are unique.
- **SQLite Store** – An SQL database used by the client to store account and note data.
- **Authenticator** - The component responsible for generating transaction signatures.

Copy and paste the following code into your `src/main.rs` file.

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};
use tokio::time::Duration;

use miden_client::{
    ClientError,
    account::{
        AccountBuilder, AccountId, AccountType,
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
    },
    asset::{AssetAmount, AssetCallbackFlag, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteType, P2idNote},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{PaymentNoteDescription, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::account::AccountIdVersion;
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

Run the following command to execute `src/main.rs`:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

After the program executes, you should see the latest block number printed to the terminal, for example:

```text
Latest block: <current_block_number>
```

## Step 3: Creating a wallet

Now that we've initialized the client, we can create a wallet for Alice.

To create a wallet for Alice using the Miden client, we select `AccountType::Public` or `AccountType::Private`. A wallet on Miden is simply an account with standardized code.

In the example below we create a public account for Alice.

Insert this snippet inside `main()`, immediately before its final `Ok(())`:

```rust ignore
//------------------------------------------------------------
// STEP 1: Create a basic wallet for Alice
//------------------------------------------------------------
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

let alice_account_id_bech32 = alice_account.id().to_bech32(network.network_id());
println!("Alice's account ID: {:?}", alice_account_id_bech32);

fund_account_for_fees(&mut client, alice_account.id(), &fee_config).await?;
```

## Step 4: Deploying a fungible faucet

To provide Alice with the tutorial's `MID` asset, we first deploy a faucet. This is separate from the public testnet faucet that supplies the native asset used to pay transaction fees. A faucet account on Miden mints its own fungible token.

We'll create a public faucet with a token symbol, decimals, and a max supply. Amounts in these examples are raw units: with eight decimals, `100` units means `0.000001 MID`. The faucet's maximum supply is `1_000_000` raw units. We will use it to mint tokens to Alice's account in the next section.

Insert this snippet inside `main()`, immediately before its final `Ok(())`:

```rust ignore
//------------------------------------------------------------
// STEP 2: Deploy a fungible faucet
//------------------------------------------------------------
println!("\n[STEP 2] Deploying a new fungible faucet.");

// Faucet seed
let mut init_seed = [0u8; 32];
client.rng().fill_bytes(&mut init_seed);

// Faucet parameters
let symbol = TokenSymbol::new("MID").unwrap();
let decimals = 8;
let max_supply = AssetAmount::new(1_000_000).unwrap();

// Generate key pair
let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

// Build the faucet account.
// The faucet is a `FungibleFaucet` component plus a `TokenPolicyManager`
// that registers an "allow all" mint (and burn) policy; minting is rejected
// unless an active mint policy is present.
let faucet = FungibleFaucet::builder()
    .name(TokenName::new("MID").unwrap())
    .symbol(symbol)
    .decimals(decimals)
    .max_supply(max_supply)
    .build()
    .unwrap();
let policies = TokenPolicyManager::builder()
    .active_mint_policy(MintPolicy::allow_all())
    .active_burn_policy(BurnPolicy::allow_all())
    .build();
// The SDK factory includes BasicWallet so the faucet can receive the native fee asset.
let faucet_account = create_singlesig_user_fungible_faucet(
    init_seed,
    faucet,
    AuthSingleSig::from_public_key(key_pair.public_key()),
    policies,
    AccountType::Public,
)
.unwrap();

// Add the faucet to the client
client.add_account(&faucet_account, false).await?;

// Add the key pair to the keystore
keystore
    .add_key(&key_pair, faucet_account.id())
    .await
    .unwrap();

let faucet_account_id_bech32 = faucet_account.id().to_bech32(network.network_id());
println!("Faucet account ID: {:?}", faucet_account_id_bech32);

fund_account_for_fees(&mut client, faucet_account.id(), &fee_config).await?;

// Resync to show newly deployed faucet
client.sync_state().await?;
tokio::time::sleep(Duration::from_secs(2)).await;
```

`client.add_account` registers each new account locally. `fund_account_for_fees` then consumes a native-asset funding note; this first confirmed transaction deploys the account and gives it a fee balance.

_When tokens are minted from this faucet, each token batch is represented as a "note" (UTXO). You can think of a Miden Note as a cryptographic cashier's check that has certain spend conditions attached to it._

## Summary

Your updated `main()` function in `src/main.rs` should look like this:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};
use tokio::time::Duration;

use miden_client::{
    ClientError,
    account::{
        AccountBuilder, AccountId, AccountType,
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
    },
    asset::{AssetAmount, AssetCallbackFlag, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteType, P2idNote},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{PaymentNoteDescription, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::account::AccountIdVersion;
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

    //------------------------------------------------------------
    // STEP 1: Create a basic wallet for Alice
    //------------------------------------------------------------
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

    let alice_account_id_bech32 = alice_account.id().to_bech32(network.network_id());
    println!("Alice's account ID: {:?}", alice_account_id_bech32);

    fund_account_for_fees(&mut client, alice_account.id(), &fee_config).await?;

    //------------------------------------------------------------
    // STEP 2: Deploy a fungible faucet
    //------------------------------------------------------------
    println!("\n[STEP 2] Deploying a new fungible faucet.");

    // Faucet seed
    let mut init_seed = [0u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Faucet parameters
    let symbol = TokenSymbol::new("MID").unwrap();
    let decimals = 8;
    let max_supply = AssetAmount::new(1_000_000).unwrap();

    // Generate key pair
    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    // Build the faucet account.
    // The faucet is a `FungibleFaucet` component plus a `TokenPolicyManager`
    // that registers an "allow all" mint (and burn) policy; minting is rejected
    // unless an active mint policy is present.
    let faucet = FungibleFaucet::builder()
        .name(TokenName::new("MID").unwrap())
        .symbol(symbol)
        .decimals(decimals)
        .max_supply(max_supply)
        .build()
        .unwrap();
    let policies = TokenPolicyManager::builder()
        .active_mint_policy(MintPolicy::allow_all())
        .active_burn_policy(BurnPolicy::allow_all())
        .build();
    // The SDK factory includes BasicWallet so the faucet can receive the native fee asset.
    let faucet_account = create_singlesig_user_fungible_faucet(
        init_seed,
        faucet,
        AuthSingleSig::from_public_key(key_pair.public_key()),
        policies,
        AccountType::Public,
    )
    .unwrap();

    // Add the faucet to the client
    client.add_account(&faucet_account, false).await?;

    // Add the key pair to the keystore
    keystore
        .add_key(&key_pair, faucet_account.id())
        .await
        .unwrap();

    let faucet_account_id_bech32 = faucet_account.id().to_bech32(network.network_id());
    println!("Faucet account ID: {:?}", faucet_account_id_bech32);

    fund_account_for_fees(&mut client, faucet_account.id(), &fee_config).await?;

    // Resync to show newly deployed faucet
    client.sync_state().await?;
    tokio::time::sleep(Duration::from_secs(2)).await;

    Ok(())
}
```

Let's run the `src/main.rs` program again:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

The following is an abbreviated output; account IDs and block numbers vary, and the funding helper also prints transaction confirmations:

```text
Latest block: <current_block_number>

[STEP 1] Creating a new account for Alice
Alice's account ID: "<alice_testnet_account_id>"

[STEP 2] Deploying a new fungible faucet.
Faucet account ID: "<faucet_testnet_account_id>"
```

In this section we explained how to instantiate the Miden client, create a wallet account, and deploy a faucet.

In the next section we will cover how to mint tokens from the faucet, consume notes, and send tokens to other accounts.

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin create_mint_consume_send
```

### Continue learning

Next tutorial: [Mint, Consume, and Create Notes](mint_consume_create_tutorial.md)
