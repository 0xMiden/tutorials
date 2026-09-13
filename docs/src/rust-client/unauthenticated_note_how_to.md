---
title: "How to Use Unauthenticated Notes"
sidebar_position: 9
---

# How to Use Unauthenticated Notes

_Using unauthenticated notes for optimistic note consumption_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In this guide, we supply a complete note to a consuming transaction before waiting for the note's inclusion proof. Such an input is unauthenticated: the node checks the dependency on its creation transaction. This lets a note be created and consumed within the same block, although confirmation still depends on block production.

We construct the transfer chain with `TransactionRequestBuilder::explicit_input_notes`, wrapping each complete `Note` in `InputNote::unauthenticated`. This pins the input mode even if a sync has already fetched its inclusion proof. `build_consume_notes` selects the mode from the store and can authenticate an input when a proof is available. We also serialize and deserialize each note to demonstrate how its details could be sent between clients. The example uses one client for all accounts and waits for each transfer and consumption to confirm before beginning the next hop.

For example, our demo creates a chain of unauthenticated note transactions:

```markdown
Alice ➡ Bob ➡ Charlie ➡ Dave ➡ Eve
```

## What we'll cover

- **Introduction to Unauthenticated Notes:** Understand what unauthenticated notes are and how they differ from standard notes.
- **Serialization Example:** See how to serialize and deserialize a note to demonstrate how notes can be propagated to client instances faster than the blocktime.
- **Confirmation and balances:** Check each transaction and verify the final balances after four transfers between five accounts.

## Step-by-step process

1. **Client Initialization:**
   - Set up an RPC client to connect with the Miden testnet.
   - Initialize a random coin generator and a store for persisting account data.

2. **Deploying a Fungible Faucet:**
   - Use a random seed to deploy a fungible faucet.
   - Configure the faucet parameters (symbol, decimals, and max supply) and add it to the client.

3. **Creating Wallet Accounts:**
   - Build multiple wallet accounts using a secure key generation process.
   - Add these accounts to the client, making them ready for transactions.

4. **Minting and Transacting with Unauthenticated Notes:**
   - Mint tokens for one of the accounts (Alice) from the deployed faucet.
   - Create a note representing the minted tokens.
   - Submit the note-creation transaction without waiting for confirmation, then pass the complete note to `.explicit_input_notes([(InputNote::unauthenticated(note), None)])`. The explicit mode stays unauthenticated even if the note commits before the consuming transaction executes.
   - Serialize the note to demonstrate how it could be transferred to another client instance.
   - Consume the note in a subsequent transaction, effectively creating a chain of unauthenticated transactions.

5. **Performance Timing and Syncing:**
   - Measure the time taken for each transaction iteration.
   - Sync the client state and print account balances to verify the transactions.

## Set up the Rust project

Start in the directory containing your `tutorials` clone and create a sibling Cargo project:

```bash
cargo new miden-unauthenticated-notes
cd miden-unauthenticated-notes
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Keep the generated `[package]` section in `Cargo.toml`, replace its empty `[dependencies]` section with the following, and add the development profile. The path assumes the repository clone is named `tutorials`.

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

Copy the complete Rust example below into `src/main.rs`. Run it from this new project's directory with `TUTORIAL_NETWORK=testnet cargo run --release`. The client creates `store.sqlite3` and `keystore/` here; keep both out of version control.

## Full Rust code example

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};
use tokio::time::{Duration, Instant};

use miden_client::{
    Client, ClientError,
    account::{
        AccountBuilder, AccountType,
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
    },
    asset::{AssetAmount, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteType, P2idNote},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{TransactionId, TransactionRequestBuilder},
    utils::{Deserializable, Serializable},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::transaction::InputNote;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    rust_client::wait_for_transaction(client, tx_id).await
}

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
    // STEP 1: Deploy a fungible faucet
    //------------------------------------------------------------
    println!("\n[STEP 1] Deploying a new fungible faucet.");

    // Faucet seed
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Generate key pair
    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    // Faucet parameters
    let symbol = TokenSymbol::new("MID").unwrap();
    let decimals = 8;
    let max_supply = AssetAmount::new(1_000_000).unwrap();

    // Build the account
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

    println!(
        "Faucet account ID: {}",
        faucet_account.id().to_bech32(network.network_id())
    );

    // Add the key pair to the keystore
    keystore
        .add_key(&key_pair, faucet_account.id())
        .await
        .unwrap();
    fund_account_for_fees(&mut client, faucet_account.id(), &fee_config).await?;

    // Resync to show newly deployed faucet
    tokio::time::sleep(Duration::from_secs(2)).await;
    client.sync_state().await?;

    //------------------------------------------------------------
    // STEP 2: Create basic wallet accounts
    //------------------------------------------------------------
    println!("\n[STEP 2] Creating new accounts");

    let mut accounts = vec![];
    let number_of_accounts = 5;

    for i in 0..number_of_accounts {
        let mut init_seed = [0_u8; 32];
        client.rng().fill_bytes(&mut init_seed);

        let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

        let account = AccountBuilder::new(init_seed)
            .account_type(AccountType::Public)
            .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
            .with_component(BasicWallet)
            .build()
            .unwrap();

        accounts.push(account.clone());
        println!(
            "account id {:?}: {}",
            i,
            account.id().to_bech32(network.network_id())
        );
        client.add_account(&account, true).await?;

        // Add the key pair to the keystore
        keystore.add_key(&key_pair, account.id()).await.unwrap();
        fund_account_for_fees(&mut client, account.id(), &fee_config).await?;
    }

    // For demo purposes, Alice is the first account.
    let alice = &accounts[0];

    //------------------------------------------------------------
    // STEP 3: Mint and consume tokens for Alice
    //------------------------------------------------------------
    println!("\n[STEP 3] Mint tokens");
    println!("Minting tokens for Alice...");
    let amount: u64 = 100;
    let fungible_asset_mint_amount = FungibleAsset::new(faucet_account.id(), amount).unwrap();
    let transaction_request = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(
            fungible_asset_mint_amount,
            alice.id(),
            NoteType::Public,
            client.rng(),
        )
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(faucet_account.id(), transaction_request)
        .await?;
    println!("Minted tokens. TX: {:?}", tx_id);

    // Wait for mint transaction to be committed
    wait_for_tx(&mut client, tx_id).await?;

    // Get the minted note and consume it
    let consumable_notes = client
        .get_consumable_tutorial_notes(Some(alice.id()))
        .await?;

    if let Some((note_record, _)) = consumable_notes.first() {
        let note: Note = note_record.clone().try_into()?;
        let transaction_request =
            TransactionRequestBuilder::new().build_consume_notes(vec![note])?;

        let consume_tx_id = client
            .submit_tutorial_transaction(alice.id(), transaction_request)
            .await?;
        println!("Consumed minted note. TX: {:?}", consume_tx_id);

        // Wait for consumption to complete
        wait_for_tx(&mut client, consume_tx_id).await?;
    }

    //------------------------------------------------------------
    // STEP 4: Create unauthenticated note tx chain
    //------------------------------------------------------------
    println!("\n[STEP 4] Create unauthenticated note tx chain");
    let start = Instant::now();

    for i in 0..number_of_accounts - 1 {
        let loop_start = Instant::now();
        println!("\nunauthenticated tx {:?}", i + 1);
        println!(
            "sender: {}",
            accounts[i].id().to_bech32(network.network_id())
        );
        println!(
            "target: {}",
            accounts[i + 1].id().to_bech32(network.network_id())
        );

        // Time the creation of the p2id note
        let send_amount = 20;
        let fungible_asset_send_amount =
            FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

        // for demo purposes, unauthenticated notes can be public or private
        let note_type = if i % 2 == 0 {
            NoteType::Private
        } else {
            NoteType::Public
        };

        let p2id_note: Note = P2idNote::builder()
            .sender(accounts[i].id())
            .target(accounts[i + 1].id())
            .asset(fungible_asset_send_amount)
            .note_type(note_type)
            .generate_serial_number(client.rng())
            .build()
            .unwrap()
            .into();

        let output_note = p2id_note.clone();

        // Time transaction request building
        let transaction_request = TransactionRequestBuilder::new()
            .own_output_notes(vec![output_note])
            .build()
            .unwrap();

        // Do not wait for inclusion: the receiver is given the complete note below.
        client.sync_state().await?;
        let send_tx_id = client
            .submit_new_transaction(accounts[i].id(), transaction_request)
            .await?;
        println!("Created note. TX: {:?}", send_tx_id);

        // Note serialization/deserialization
        // This demonstrates how you could send the serialized note to another client instance
        let serialized = p2id_note.to_bytes();
        let deserialized_p2id_note = Note::read_from_bytes(&serialized).unwrap();

        // Time consume note request building
        // Keep this input unauthenticated even if syncing has already fetched its proof.
        let consume_note_request = TransactionRequestBuilder::new()
            .explicit_input_notes([(InputNote::unauthenticated(deserialized_p2id_note), None)])
            .build()?;

        let tx_id = client
            .submit_tutorial_transaction(accounts[i + 1].id(), consume_note_request)
            .await?;
        rust_client::wait_for_transaction(&mut client, send_tx_id).await?;

        println!(
            "Consumed Note Tx on MidenScan: {}/tx/{:?}",
            network.explorer_url(),
            tx_id
        );
        println!(
            "Total time for loop iteration {}: {:?}",
            i,
            loop_start.elapsed()
        );
    }

    println!(
        "\nTotal execution time for unauthenticated note txs: {:?}",
        start.elapsed()
    );

    // Final resync and display account balances
    tokio::time::sleep(Duration::from_secs(3)).await;
    client.sync_state().await?;
    for (index, account) in accounts.iter().enumerate() {
        let new_account = client.get_account(account.id()).await.unwrap().unwrap();
        let balance = new_account
            .vault()
            .get_balance(AssetId::new_fungible(faucet_account.id()))
            .unwrap();
        println!(
            "Account: {} balance: {}",
            account.id().to_bech32(network.network_id()),
            balance
        );
        let expected = if index == 0 {
            80
        } else if index == accounts.len() - 1 {
            20
        } else {
            0
        };
        assert_eq!(
            balance.as_u64(),
            expected,
            "unexpected transfer-chain balance"
        );
    }

    Ok(())
}
```

The following is an abbreviated output. IDs and timings vary; each measured iteration includes confirmation polling, and funding logs are omitted:

```text
Latest block: <current_block_number>

[STEP 1] Deploying a new fungible faucet.
Faucet account ID: <faucet_testnet_account_id>

[STEP 2] Creating new accounts
account id 0: <account_0_id>
account id 1: <account_1_id>
account id 2: <account_2_id>
account id 3: <account_3_id>
account id 4: <account_4_id>

[STEP 3] Mint tokens
Minting tokens for Alice...
Minted tokens. TX: <transaction_id>
Consumed minted note. TX: <transaction_id>

[STEP 4] Create unauthenticated note tx chain

unauthenticated tx 1
sender: <account_0_id>
target: <account_1_id>
Created note. TX: <send_transaction_id>
Transaction committed: <consume_transaction_id>
Transaction committed: <send_transaction_id>
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<consume_transaction_id>
Total time for loop iteration 0: <elapsed_time>

unauthenticated tx 2
sender: <account_1_id>
target: <account_2_id>
Created note. TX: <send_transaction_id>
Transaction committed: <consume_transaction_id>
Transaction committed: <send_transaction_id>
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<consume_transaction_id>
Total time for loop iteration 1: <elapsed_time>

unauthenticated tx 3
sender: <account_2_id>
target: <account_3_id>
Created note. TX: <send_transaction_id>
Transaction committed: <consume_transaction_id>
Transaction committed: <send_transaction_id>
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<consume_transaction_id>
Total time for loop iteration 2: <elapsed_time>

unauthenticated tx 4
sender: <account_3_id>
target: <account_4_id>
Created note. TX: <send_transaction_id>
Transaction committed: <consume_transaction_id>
Transaction committed: <send_transaction_id>
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<consume_transaction_id>
Total time for loop iteration 3: <elapsed_time>

Total execution time for unauthenticated note txs: <elapsed_time>
Account: <account_0_id> balance: 80
Account: <account_1_id> balance: 0
Account: <account_2_id> balance: 0
Account: <account_3_id> balance: 0
Account: <account_4_id> balance: 20
```

## Conclusion

This example builds and serializes complete notes, then consumes the four transfer notes through `explicit_input_notes` with an explicitly unauthenticated mode. The earlier mint consumption uses `build_consume_notes` and may be authenticated. It confirms four transfers across five accounts and checks the tutorial-asset balances `[80, 0, 0, 0, 20]`; each account's native fee balance is separate.

Applications can use this pattern to submit dependent transactions before the notes are committed. The node must still accept the creation transaction for its dependent consumption to settle.

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin unauthenticated_note_transfer
```

### Continue learning

Next tutorial: [How to Use Mappings in Miden Assembly](mappings_in_masm_how_to.md)
