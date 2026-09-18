---
title: "Mint, Consume, and Create Notes"
sidebar_position: 3
---

# Mint, Consume, and Create Notes

_Using the Miden client in Rust to mint, consume, and create notes_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In the previous section, we initialized our repository and covered how to create an account and deploy a faucet. In this section, we will mint tokens from the faucet for _Alice_, consume the newly created notes, and demonstrate how to send assets to other accounts.

## What we'll cover

- Minting tokens from a faucet
- Consuming notes to fund an account
- Sending tokens to other users

## Step 1: Minting tokens from the faucet

To mint notes with tokens from the faucet we created, the client submits a mint transaction signed by the faucet's key. The faucet executes the transaction and creates a note for Alice; Alice later signs a separate transaction to consume it.

_In essence, a transaction request is a structured template that outlines the data required to generate a zero-knowledge proof of a state change of an account. It specifies which input notes (if any) will be consumed, includes an optional transaction script to execute, and enumerates the set of notes expected to be created (if any)._

Below is an example of a transaction request minting tokens from the faucet for Alice. This code snippet creates and confirms five mint transactions, each producing one note containing 100 raw units of the tutorial asset. Transaction fees are paid in the separate native fee asset.

Continue the same project from [Creating Accounts and Faucets](./create_deploy_tutorial.md), keeping its `Cargo.toml` and seeded `Cargo.lock`. Insert this snippet inside `main()`, after the previous steps and immediately before its final `Ok(())`:

```rust ignore
//------------------------------------------------------------
// STEP 3: Mint 5 notes of 100 tokens for Alice
//------------------------------------------------------------
println!("\n[STEP 3] Minting 5 notes of 100 tokens each for Alice.");

let amount: u64 = 100;
let fungible_asset = FungibleAsset::new(faucet_account.id(), amount).unwrap();

let mut minted_note_ids = Vec::new();
for i in 1..=5 {
    let transaction_request = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(
            fungible_asset,
            alice_account.id(),
            NoteType::Public,
            client.rng(),
        )
        .unwrap();

    minted_note_ids.extend(
        transaction_request
            .expected_output_own_notes()
            .iter()
            .map(Note::id),
    );
    println!("tx request built");

    let tx_id = client
        .submit_tutorial_transaction(faucet_account.id(), transaction_request)
        .await?;
    println!(
        "Minted note #{} of {} tokens for Alice. TX: {:?}",
        i, amount, tx_id
    );
}
println!("All 5 notes minted for Alice successfully!");

// Re-sync so minted notes become visible
client.sync_state().await?;
```

## Step 2: Identifying consumable notes

Once Alice has minted a note from the faucet, she will eventually want to spend the tokens that she received in the note created by the mint transaction.

Minting a note from a faucet on Miden means a faucet account creates a new note targeted to the requesting account. The requesting account needs to consume this new note to have the assets appear in their account.

To identify consumable notes, the Miden client provides `get_consumable_notes`. The `TutorialClientExt::get_consumable_tutorial_notes` wrapper used below filters out `TX_FEE` notes. Call it after syncing the client state.

Track the output note IDs from each mint request and wait for those notes to be committed. Do not wait for the total consumable-note count to equal five: `TX_FEE` notes can also be consumable and make that condition impossible. The `wait_for_notes_by_id` helper in Step 3 polls for the specific minted notes with a timeout.

#### Identifying which notes are available:

```rust ignore
let consumable_notes = client
    .get_consumable_tutorial_notes(Some(alice_account.id()))
    .await?;
```

## Step 3: Consuming multiple notes in a single transaction:

Now that we know how to identify notes ready to consume, let's consume the notes created by the faucet in a single transaction. After consuming the notes, Alice's wallet balance will be updated.

The following code snippet identifies consumable notes and consumes them in a single transaction.

Insert this snippet after the preceding steps inside `main()`, immediately before its final `Ok(())`:

```rust ignore
//------------------------------------------------------------
// STEP 4: Alice consumes all her notes
//------------------------------------------------------------
println!("\n[STEP 4] Alice will now consume all of her notes to consolidate them.");

// TX_FEE notes are also consumable. Select only the five P2ID notes we minted.
let notes = rust_client::wait_for_notes_by_id(&mut client, &minted_note_ids).await?;
assert_eq!(notes.len(), 5);
let transaction_request = TransactionRequestBuilder::new().build_consume_notes(notes)?;
let tx_id = client
    .submit_tutorial_transaction(alice_account.id(), transaction_request)
    .await?;
println!(
    "All of Alice's notes consumed successfully. TX: {:?}",
    tx_id
);

// `alice_account` was created before the consume transaction. Retrieve Alice
// again from the client before reading state changed by that transaction.
let updated_alice_account = client
    .get_account(alice_account.id())
    .await?
    .expect("Alice's account should be tracked by the client");
let updated_balance = updated_alice_account
    .vault()
    .get_balance(AssetId::new_fungible(faucet_account.id()))?;
assert_eq!(
    updated_balance.as_u64(),
    500,
    "Alice should hold the five consumed 100-unit notes"
);
```

## Step 4: Sending tokens to other accounts

After consuming the notes, Alice has tokens in her wallet. Now, she wants to send tokens to her friends. She has two options: create a separate transaction for each transfer or batch multiple transfers into a single transaction.

_The standard asset transfer note on Miden is the P2ID note (Pay-to-Id). There is also the P2IDE (Pay-to-Id Extended) variant which allows for both timelocking the note (target can only spend the note after a certain block height) and for the note to be reclaimable (the creator of the note can reclaim the note after a certain block height)._

In our example, Alice will now send 50 tokens to 5 different accounts.

For the sake of the example, the first four P2ID transfers are handled in a single transaction, and the fifth transfer is a standard P2ID transfer.

### Output multiple P2ID notes in a single transaction

To output multiple notes in a single transaction we need to create a list of our expected output notes. The expected output notes are the notes that we expect to create in our transaction request.

In the snippet below, we create an empty vector, loop over four iterations using `1..=4`, build a P2ID note for each generated dummy account ID, and push each note onto the vector. We pass all four notes to `.own_output_notes()` and submit one transaction. The following step sends the fifth note.

Insert this snippet after the preceding steps inside `main()`, immediately before its final `Ok(())`:

```rust ignore
//------------------------------------------------------------
// STEP 5: Alice sends 5 notes of 50 tokens to 5 users
//------------------------------------------------------------
println!("\n[STEP 5] Alice sends 5 notes of 50 tokens each to 5 different users.");

// Send 50 tokens to 4 accounts in one transaction
println!("Creating multiple P2ID notes for 4 target accounts in one transaction...");
let mut p2id_notes = vec![];

// Creating 4 P2ID notes to 4 'dummy' AccountIds
for _ in 1..=4 {
    let init_seed: [u8; 15] = {
        let mut init_seed = [0_u8; 15];
        client.rng().fill_bytes(&mut init_seed);
        init_seed
    };
    let target_account_id = AccountId::dummy(
        init_seed,
        AccountIdVersion::Version1,
        AccountType::Public,
        AssetCallbackFlag::Disabled,
    );

    let send_amount = 50;
    let fungible_asset = FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

    let p2id_note: Note = P2idNote::builder()
        .sender(alice_account.id())
        .target(target_account_id)
        .asset(fungible_asset)
        .note_type(NoteType::Public)
        .generate_serial_number(client.rng())
        .build()?
        .into();
    p2id_notes.push(p2id_note);
}

// Specifying output notes and creating a tx request to create them
let output_notes = p2id_notes;
let transaction_request = TransactionRequestBuilder::new()
    .own_output_notes(output_notes)
    .build()
    .unwrap();

let tx_id = client
    .submit_tutorial_transaction(alice_account.id(), transaction_request)
    .await?;

println!("Submitted a transaction with 4 P2ID notes. TX: {:?}", tx_id);
```

### Basic P2ID transfer

`build_pay_to_id` creates the P2ID note and transaction request for a single transfer. Alice will use it to send tokens to one more account.

Insert this snippet after the preceding steps inside `main()`, immediately before its final `Ok(())`:

```rust ignore
println!("Submitting one more single P2ID transaction...");
let init_seed: [u8; 15] = {
    let mut init_seed = [0_u8; 15];
    client.rng().fill_bytes(&mut init_seed);
    init_seed
};
let target_account_id = AccountId::dummy(
    init_seed,
    AccountIdVersion::Version1,
    AccountType::Public,
    AssetCallbackFlag::Disabled,
);

let send_amount = 50;
let fungible_asset = FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

let payment = PaymentNoteDescription::new(
    vec![fungible_asset.into()],
    alice_account.id(),
    target_account_id,
);
let transaction_request = TransactionRequestBuilder::new().build_pay_to_id(
    payment,
    NoteType::Public,
    client.rng(),
)?;

let tx_id = client
    .submit_tutorial_transaction(alice_account.id(), transaction_request)
    .await?;

println!("Submitted final P2ID transaction. TX: {:?}", tx_id);
let alice = client
    .get_account(alice_account.id())
    .await?
    .expect("Alice exists");
let balance = alice
    .vault()
    .get_balance(AssetId::new_fungible(faucet_account.id()))?;
assert_eq!(balance.as_u64(), 250, "Alice should retain 500 - 250 MID");

println!("\nAll steps completed successfully!");
println!("Alice created a wallet, a faucet was deployed,");
println!("5 notes of 100 tokens were minted to Alice, those notes were consumed,");
println!("and then Alice sent 5 separate 50-token notes to 5 different users.");
```

Note: _`AccountId::dummy()` generates example IDs without deployable accounts or keys. These notes demonstrate creation and cannot be consumed by real recipients. Use actual recipient IDs when transferring useful assets._

## Summary

Your `src/main.rs` function should now look like this:

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

    //------------------------------------------------------------
    // STEP 3: Mint 5 notes of 100 tokens for Alice
    //------------------------------------------------------------
    println!("\n[STEP 3] Minting 5 notes of 100 tokens each for Alice.");

    let amount: u64 = 100;
    let fungible_asset = FungibleAsset::new(faucet_account.id(), amount).unwrap();

    let mut minted_note_ids = Vec::new();
    for i in 1..=5 {
        let transaction_request = TransactionRequestBuilder::new()
            .build_mint_fungible_asset(
                fungible_asset,
                alice_account.id(),
                NoteType::Public,
                client.rng(),
            )
            .unwrap();

        minted_note_ids.extend(
            transaction_request
                .expected_output_own_notes()
                .iter()
                .map(Note::id),
        );
        println!("tx request built");

        let tx_id = client
            .submit_tutorial_transaction(faucet_account.id(), transaction_request)
            .await?;
        println!(
            "Minted note #{} of {} tokens for Alice. TX: {:?}",
            i, amount, tx_id
        );
    }
    println!("All 5 notes minted for Alice successfully!");

    // Re-sync so minted notes become visible
    client.sync_state().await?;

    //------------------------------------------------------------
    // STEP 4: Alice consumes all her notes
    //------------------------------------------------------------
    println!("\n[STEP 4] Alice will now consume all of her notes to consolidate them.");

    // TX_FEE notes are also consumable. Select only the five P2ID notes we minted.
    let notes = rust_client::wait_for_notes_by_id(&mut client, &minted_note_ids).await?;
    assert_eq!(notes.len(), 5);
    let transaction_request = TransactionRequestBuilder::new().build_consume_notes(notes)?;
    let tx_id = client
        .submit_tutorial_transaction(alice_account.id(), transaction_request)
        .await?;
    println!(
        "All of Alice's notes consumed successfully. TX: {:?}",
        tx_id
    );

    //------------------------------------------------------------
    // STEP 5: Alice sends 5 notes of 50 tokens to 5 users
    //------------------------------------------------------------
    println!("\n[STEP 5] Alice sends 5 notes of 50 tokens each to 5 different users.");

    // Send 50 tokens to 4 accounts in one transaction
    println!("Creating multiple P2ID notes for 4 target accounts in one transaction...");
    let mut p2id_notes = vec![];

    // Creating 4 P2ID notes to 4 'dummy' AccountIds
    for _ in 1..=4 {
        let init_seed: [u8; 15] = {
            let mut init_seed = [0_u8; 15];
            client.rng().fill_bytes(&mut init_seed);
            init_seed
        };
        let target_account_id = AccountId::dummy(
            init_seed,
            AccountIdVersion::Version1,
            AccountType::Public,
            AssetCallbackFlag::Disabled,
        );

        let send_amount = 50;
        let fungible_asset = FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

        let p2id_note: Note = P2idNote::builder()
            .sender(alice_account.id())
            .target(target_account_id)
            .asset(fungible_asset)
            .note_type(NoteType::Public)
            .generate_serial_number(client.rng())
            .build()?
            .into();
        p2id_notes.push(p2id_note);
    }

    // Specifying output notes and creating a tx request to create them
    let output_notes = p2id_notes;
    let transaction_request = TransactionRequestBuilder::new()
        .own_output_notes(output_notes)
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(alice_account.id(), transaction_request)
        .await?;

    println!("Submitted a transaction with 4 P2ID notes. TX: {:?}", tx_id);

    println!("Submitting one more single P2ID transaction...");
    let init_seed: [u8; 15] = {
        let mut init_seed = [0_u8; 15];
        client.rng().fill_bytes(&mut init_seed);
        init_seed
    };
    let target_account_id = AccountId::dummy(
        init_seed,
        AccountIdVersion::Version1,
        AccountType::Public,
        AssetCallbackFlag::Disabled,
    );

    let send_amount = 50;
    let fungible_asset = FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

    let payment = PaymentNoteDescription::new(
        vec![fungible_asset.into()],
        alice_account.id(),
        target_account_id,
    );
    let transaction_request = TransactionRequestBuilder::new().build_pay_to_id(
        payment,
        NoteType::Public,
        client.rng(),
    )?;

    let tx_id = client
        .submit_tutorial_transaction(alice_account.id(), transaction_request)
        .await?;

    println!("Submitted final P2ID transaction. TX: {:?}", tx_id);
    let alice = client
        .get_account(alice_account.id())
        .await?
        .expect("Alice exists");
    let balance = alice
        .vault()
        .get_balance(AssetId::new_fungible(faucet_account.id()))?;
    assert_eq!(balance.as_u64(), 250, "Alice should retain 500 - 250 MID");

    println!("\nAll steps completed successfully!");
    println!("Alice created a wallet, a faucet was deployed,");
    println!("5 notes of 100 tokens were minted to Alice, those notes were consumed,");
    println!("and then Alice sent 5 separate 50-token notes to 5 different users.");

    Ok(())
}
```

Let's run the `src/main.rs` program again:

```bash
TUTORIAL_NETWORK=testnet cargo run --release
```

The following is an abbreviated output; IDs vary and the helper also prints funding and transaction confirmations:

```text
Latest block: <current_block_number>

[STEP 1] Creating a new account for Alice
Alice's account ID: "<alice_testnet_account_id>"

[STEP 2] Deploying a new fungible faucet.
Faucet account ID: "<faucet_testnet_account_id>"

[STEP 3] Minting 5 notes of 100 tokens each for Alice.
tx request built
Minted note #1 of 100 tokens for Alice. TX: <transaction_id>
...
Minted note #5 of 100 tokens for Alice. TX: <transaction_id>
All 5 notes minted for Alice successfully!

[STEP 4] Alice will now consume all of her notes to consolidate them.
All of Alice's notes consumed successfully. TX: <transaction_id>

[STEP 5] Alice sends 5 notes of 50 tokens each to 5 different users.
Creating multiple P2ID notes for 4 target accounts in one transaction...
Submitted a transaction with 4 P2ID notes. TX: <transaction_id>
Submitting one more single P2ID transaction...
Submitted final P2ID transaction. TX: <transaction_id>

All steps completed successfully!
Alice created a wallet, a faucet was deployed,
5 notes of 100 tokens were minted to Alice, those notes were consumed,
and then Alice sent 5 separate 50-token notes to 5 different users.
```

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin create_mint_consume_send
```

### Continue learning

Next tutorial: [Deploying a Counter Contract](counter_contract_tutorial.md)
