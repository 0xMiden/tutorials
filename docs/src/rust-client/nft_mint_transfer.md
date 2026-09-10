---
title: "Mint and Transfer an NFT"
sidebar_position: 3.5
---

# Mint and Transfer an NFT

_Using the Miden client in Rust to mint a non-fungible asset and transfer it between wallets_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In this tutorial, we will create an NFT collection, mint one NFT to Alice, and transfer it to Bob. Both wallets and the faucet use signature authentication. The example uses the standard `NonFungibleFaucet`, `MintNote`, and P2ID note implementations.

As in [Mint, Consume, and Create Notes](./mint_consume_create_tutorial.md), receiving a note and holding its asset in a wallet are separate steps. Alice and Bob each consume their NFT note before the NFT appears in their vault.

## What we'll cover

- Creating authenticated wallets and an NFT faucet with native fee funding
- Computing an NFT's value from metadata and a salt
- Publishing a MINT request and consuming the minted NFT
- Transferring the NFT to Bob and verifying ownership

## Prerequisites

Follow the [v0.16 Rust setup](./index.md#running-the-v016-examples) in a clone of this repository. This tutorial uses its pinned dependencies and shared client helpers. Testnet is the verified network for this example.

The following snippets walk through `rust-client/src/bin/nft_mint_transfer.rs` in execution order. They belong inside the same `main()` function and share its variables; the [complete example](#summary) includes the imports and function wrapper.

## Step 1: Initialize the client and create wallets

Initialize the client with the selected network, a local SQLite store, and a filesystem keystore. Synchronize it before reading the chain's fee configuration:

```rust ignore
let network = TutorialNetwork::from_env()?;
let rpc = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
    &network.endpoint(),
    10_000,
)));
let keystore = Arc::new(FilesystemKeyStore::new(PathBuf::from("./keystore"))?);
let mut client = ClientBuilder::new()
    .rpc(rpc)
    .sqlite_store(PathBuf::from("./store.sqlite3"))
    .authenticator(keystore.clone())
    .build()
    .await?;
client.sync_state().await?;
let fees = FeeConfig::from_client(&client, network).await?;
```

Create Alice and Bob with `AuthSingleSig` and `BasicWallet`. Register each account and its signing key, then consume a funding note containing the native fee asset. Funding completes before the account submits any NFT transactions.

```rust ignore
let mut wallets = Vec::new();
for name in ["Alice", "Bob"] {
    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);
    let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let wallet = AccountBuilder::new(seed)
        .account_type(AccountType::Public)
        .with_component(AuthSingleSig::from_public_key(key.public_key()))
        .with_component(BasicWallet)
        .build()?;
    client.add_account(&wallet, false).await?;
    keystore.add_key(&key, wallet.id()).await?;
    fund_account_for_fees(&mut client, wallet.id(), &fees).await?;
    println!("{name}: {}", wallet.id().to_bech32(network.network_id()));
    wallets.push(wallet.id());
}
let (alice, bob) = (wallets[0], wallets[1]);
```

## Step 2: Create the NFT faucet

The collection's name and symbol describe its faucet. Configure the standard NFT component and token policies, then compose the account with authentication, authority, and pause-management components.

The faucet also needs `BasicWallet` to receive native fee funding and `CodeInspection` so the production MINT note can identify its faucet kind. Its `allow_all` mint policy accepts the example's value, while `AuthSingleSig` still requires the faucet's signature. No custom MASM is needed.

```rust ignore
let mut seed = [0_u8; 32];
client.rng().fill_bytes(&mut seed);
let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
let collection = NonFungibleFaucet::builder()
    .name(TokenName::new("Recipe Collection")?)
    .symbol(TokenSymbol::new("ART")?)
    .build();
let policies = TokenPolicyManager::builder()
    .active_mint_policy(MintPolicy::allow_all())
    .active_burn_policy(BurnPolicy::allow_all())
    .build();
// These are the user-faucet factory's standard components, plus BasicWallet
// for fee funding and CodeInspection for the production MINT note.
let faucet = AccountBuilder::new(seed)
    .account_type(AccountType::Public)
    .with_component(AuthSingleSig::from_public_key(key.public_key()))
    .with_component(collection)
    .with_component(Authority::AuthControlled)
    .with_components(policies)
    .with_component(Pausable::unpaused())
    .with_component(PausableManager)
    .with_component(BasicWallet)
    .with_component(CodeInspection)
    .build()?;
client.add_account(&faucet, false).await?;
keystore.add_key(&key, faucet.id()).await?;
fund_account_for_fees(&mut client, faucet.id(), &fees).await?;
println!(
    "NFT faucet: {}",
    faucet.id().to_bech32(network.network_id())
);
```

## Step 3: Compute the NFT value

Use `NonFungibleFaucet::compute_asset_commitment(metadata, salt)` to hash the exact metadata bytes and merge that digest with a random salt. Combine the result with the faucet's ID to describe the NFT that will be minted:

```rust ignore
let metadata = br#"{"name":"Recipe NFT #1","description":"A mint-and-transfer example"}"#;
let salt = client.rng().draw_word();
let commitment = NonFungibleFaucet::compute_asset_commitment(metadata, salt);
let nft = NonFungibleAsset::from_parts(faucet.id(), commitment);
let asset = Asset::from(nft);
println!("NFT commitment: {commitment}");
```

This creates a local asset description; minting happens in the next step.

**This commitment is an off-chain convention.** The faucet does not validate metadata, a salt, the hash construction, or knowledge of a preimage. A recipient who wants to verify metadata must recompute the commitment and compare it with the asset value. The faucet enforces uniqueness of the token ID derived from the value's first two field elements, not the truth of the metadata.

This example keeps the bytes and salt in memory. Applications that need later verification must retain and share them off-chain.

## Step 4: Publish the MINT request and mint the NFT

First describe the public P2ID note that the faucet will create for Alice. Its recipient, NFT, and tag become the storage of an **assetless MINT request**. These are two different notes: the request asks the faucet to mint; the P2ID note carries the minted asset.

```rust ignore
let alice_note: Note = P2idNote::builder()
    .sender(faucet.id())
    .target(alice)
    .asset(nft)
    .note_type(NoteType::Public)
    .generate_serial_number(client.rng())
    .build()?
    .into();
let minted_note_id = alice_note.id();
let mint_storage = MintNoteStorage::new_non_fungible_public(
    alice_note.recipient().clone(),
    nft,
    alice_note.metadata().tag(),
)?;
let mint_request: Note = MintNote::builder()
    .sender(alice)
    .mint_storage(mint_storage)
    .generate_serial_number(client.rng())
    .build()?
    .into();
let request_note_id = mint_request.id();
```

Alice signs a transaction publishing the MINT request. Track the future P2ID note and wait for the request to commit before the faucet consumes it. The faucet signs that second transaction and creates Alice's NFT-bearing note:

```rust ignore
assert_eq!(mint_request.assets().num_assets(), 0);
let request = TransactionRequestBuilder::new()
    .own_output_notes([mint_request])
    .expected_future_notes(vec![((&alice_note).into(), alice_note.metadata().tag())])
    .build()?;
client.submit_tutorial_transaction(alice, request).await?;
let mint_requests = wait_for_notes_by_id(&mut client, &[request_note_id]).await?;
let request = TransactionRequestBuilder::new()
    .expected_output_recipients([alice_note.recipient().clone()])
    .build_consume_notes(mint_requests)?;
// The faucet signs this transaction even though its mint policy is allow_all.
client
    .submit_tutorial_transaction(faucet.id(), request)
    .await?;
```

Wait for that specific P2ID note, then check that it contains exactly the expected NFT. Neither wallet holds the asset yet:

```rust ignore
let minted_notes = wait_for_notes_by_id(&mut client, &[minted_note_id]).await?;
assert_eq!(minted_notes.len(), 1);
assert_eq!(
    minted_notes[0].assets().iter().copied().collect::<Vec<_>>(),
    vec![asset]
);
assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
println!("Minted: one NFT in Alice's P2ID note; neither wallet owns it yet.");
```

## Step 5: Consume the minted NFT into Alice's wallet

Alice consumes the minted P2ID note in a separate transaction. After commitment, check the complete asset in her vault and confirm that the note is consumed:

```rust ignore
let request = TransactionRequestBuilder::new().build_consume_notes(minted_notes)?;
client.submit_tutorial_transaction(alice, request).await?;
assert_eq!(
    client.get_account_vault(alice).await?.get(nft.id()),
    Some(asset)
);
assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
assert!(client
    .get_input_note(minted_note_id)
    .await?
    .unwrap()
    .is_consumed());
println!("Consumed: Alice owns the NFT; Bob does not.");
```

## Step 6: Transfer the NFT to Bob

Use `PaymentNoteDescription` and `build_pay_to_id` to send the same NFT to Bob in a public P2ID note. Once Alice's transaction commits, the NFT is in transit: it has left her vault, but Bob has not consumed it yet.

```rust ignore
let payment = PaymentNoteDescription::new(vec![asset], alice, bob);
let request = TransactionRequestBuilder::new().build_pay_to_id(
    payment,
    NoteType::Public,
    client.rng(),
)?;
let transfer_note_id = request.expected_output_own_notes()[0].id();
client.submit_tutorial_transaction(alice, request).await?;
let transfer_notes = wait_for_notes_by_id(&mut client, &[transfer_note_id]).await?;
assert_eq!(transfer_notes.len(), 1);
assert_eq!(
    transfer_notes[0]
        .assets()
        .iter()
        .copied()
        .collect::<Vec<_>>(),
    vec![asset]
);
assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
println!("In transit: one NFT in Bob's P2ID note; neither wallet owns it.");
```

## Step 7: Consume the transfer and verify ownership

Bob consumes the transfer note. Wait for his transaction to commit, then confirm that his vault holds the original asset, Alice and the faucet do not hold it, and the transfer note is consumed:

```rust ignore
let request = TransactionRequestBuilder::new().build_consume_notes(transfer_notes)?;
client.submit_tutorial_transaction(bob, request).await?;
assert_eq!(
    client.get_account_vault(bob).await?.get(nft.id()),
    Some(asset)
);
assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
assert_eq!(
    client.get_account_vault(faucet.id()).await?.get(nft.id()),
    None
);
assert!(client
    .get_input_note(transfer_note_id)
    .await?
    .unwrap()
    .is_consumed());
println!("Complete: Bob owns the NFT; Alice does not. Both NFT notes are consumed.");
```

The ownership checks cover each stage of the flow. The vault columns below refer only to this NFT; the accounts also hold native fee assets.

| Stage          | Alice's vault | Unconsumed NFT note | Bob's vault |
| -------------- | ------------- | ------------------- | ----------- |
| Minted         | No NFT        | Addressed to Alice  | No NFT      |
| Alice consumed | Holds NFT     | None                | No NFT      |
| Alice sent     | No NFT        | Addressed to Bob    | No NFT      |
| Bob consumed   | No NFT        | None                | Holds NFT   |

Selecting the exact request, mint, and transfer note IDs keeps fee notes out of these checks. The executing account pays each transaction's fee in the native asset: Alice pays to publish, consume, and transfer; the NFT faucet pays to mint; Bob pays to consume his note.

## Summary

You have created an authenticated NFT faucet, minted one NFT into a note for Alice, consumed it, transferred it to Bob, and verified the final owner. Here is the complete runnable example, including the client setup and imports:

```rust no_run
use std::{error::Error, path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{
            Authority, BasicWallet, BurnPolicy, MintPolicy, NonFungibleFaucet, Pausable,
            PausableManager, TokenName, TokenPolicyManager,
        },
        standards::inspection::CodeInspection,
        AccountBuilder, AccountType,
    },
    asset::{Asset, NonFungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    crypto::FeltRng,
    keystore::{FilesystemKeyStore, Keystore},
    note::{MintNote, MintNoteStorage, Note, NoteType, P2idNote},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{PaymentNoteDescription, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::{
    fund_account_for_fees, wait_for_notes_by_id, FeeConfig, TutorialClientExt, TutorialNetwork,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // The runner gives each invocation a fresh store and keystore.
    let network = TutorialNetwork::from_env()?;
    let rpc = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
        &network.endpoint(),
        10_000,
    )));
    let keystore = Arc::new(FilesystemKeyStore::new(PathBuf::from("./keystore"))?);
    let mut client = ClientBuilder::new()
        .rpc(rpc)
        .sqlite_store(PathBuf::from("./store.sqlite3"))
        .authenticator(keystore.clone())
        .build()
        .await?;
    client.sync_state().await?;
    let fees = FeeConfig::from_client(&client, network).await?;

    // 1. Create authenticated wallets for Alice and Bob.
    let mut wallets = Vec::new();
    for name in ["Alice", "Bob"] {
        let mut seed = [0_u8; 32];
        client.rng().fill_bytes(&mut seed);
        let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
        let wallet = AccountBuilder::new(seed)
            .account_type(AccountType::Public)
            .with_component(AuthSingleSig::from_public_key(key.public_key()))
            .with_component(BasicWallet)
            .build()?;
        client.add_account(&wallet, false).await?;
        keystore.add_key(&key, wallet.id()).await?;
        fund_account_for_fees(&mut client, wallet.id(), &fees).await?;
        println!("{name}: {}", wallet.id().to_bech32(network.network_id()));
        wallets.push(wallet.id());
    }
    let (alice, bob) = (wallets[0], wallets[1]);

    // 2. Compose a standard user NFT faucet.
    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);
    let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let collection = NonFungibleFaucet::builder()
        .name(TokenName::new("Recipe Collection")?)
        .symbol(TokenSymbol::new("ART")?)
        .build();
    let policies = TokenPolicyManager::builder()
        .active_mint_policy(MintPolicy::allow_all())
        .active_burn_policy(BurnPolicy::allow_all())
        .build();
    // These are the user-faucet factory's standard components, plus BasicWallet
    // for fee funding and CodeInspection for the production MINT note.
    let faucet = AccountBuilder::new(seed)
        .account_type(AccountType::Public)
        .with_component(AuthSingleSig::from_public_key(key.public_key()))
        .with_component(collection)
        .with_component(Authority::AuthControlled)
        .with_components(policies)
        .with_component(Pausable::unpaused())
        .with_component(PausableManager)
        .with_component(BasicWallet)
        .with_component(CodeInspection)
        .build()?;
    client.add_account(&faucet, false).await?;
    keystore.add_key(&key, faucet.id()).await?;
    fund_account_for_fees(&mut client, faucet.id(), &fees).await?;
    println!(
        "NFT faucet: {}",
        faucet.id().to_bech32(network.network_id())
    );

    // 3. Compute the NFT value off-chain. Keep the exact bytes and salt if a
    // recipient will later verify this convention; the faucet checks neither.
    let metadata = br#"{"name":"Recipe NFT #1","description":"A mint-and-transfer example"}"#;
    let salt = client.rng().draw_word();
    let commitment = NonFungibleFaucet::compute_asset_commitment(metadata, salt);
    let nft = NonFungibleAsset::from_parts(faucet.id(), commitment);
    let asset = Asset::from(nft);
    println!("NFT commitment: {commitment}");

    // Describe the P2ID note that MINT will create for Alice.
    let alice_note: Note = P2idNote::builder()
        .sender(faucet.id())
        .target(alice)
        .asset(nft)
        .note_type(NoteType::Public)
        .generate_serial_number(client.rng())
        .build()?
        .into();
    let minted_note_id = alice_note.id();
    let mint_storage = MintNoteStorage::new_non_fungible_public(
        alice_note.recipient().clone(),
        nft,
        alice_note.metadata().tag(),
    )?;
    let mint_request: Note = MintNote::builder()
        .sender(alice)
        .mint_storage(mint_storage)
        .generate_serial_number(client.rng())
        .build()?
        .into();
    let request_note_id = mint_request.id();

    // 4. Alice publishes an assetless MINT request. The faucet must consume
    // this committed request before Alice's NFT-bearing P2ID note exists.
    assert_eq!(mint_request.assets().num_assets(), 0);
    let request = TransactionRequestBuilder::new()
        .own_output_notes([mint_request])
        .expected_future_notes(vec![((&alice_note).into(), alice_note.metadata().tag())])
        .build()?;
    client.submit_tutorial_transaction(alice, request).await?;
    let mint_requests = wait_for_notes_by_id(&mut client, &[request_note_id]).await?;
    let request = TransactionRequestBuilder::new()
        .expected_output_recipients([alice_note.recipient().clone()])
        .build_consume_notes(mint_requests)?;
    // The faucet signs this transaction even though its mint policy is allow_all.
    client
        .submit_tutorial_transaction(faucet.id(), request)
        .await?;

    let minted_notes = wait_for_notes_by_id(&mut client, &[minted_note_id]).await?;
    assert_eq!(minted_notes.len(), 1);
    assert_eq!(
        minted_notes[0].assets().iter().copied().collect::<Vec<_>>(),
        vec![asset]
    );
    assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
    assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
    println!("Minted: one NFT in Alice's P2ID note; neither wallet owns it yet.");

    // 5. Alice consumes the minted note into her vault.
    let request = TransactionRequestBuilder::new().build_consume_notes(minted_notes)?;
    client.submit_tutorial_transaction(alice, request).await?;
    assert_eq!(
        client.get_account_vault(alice).await?.get(nft.id()),
        Some(asset)
    );
    assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
    assert!(client
        .get_input_note(minted_note_id)
        .await?
        .unwrap()
        .is_consumed());
    println!("Consumed: Alice owns the NFT; Bob does not.");

    // 6. Alice transfers the same NFT to Bob in a public P2ID note.
    let payment = PaymentNoteDescription::new(vec![asset], alice, bob);
    let request = TransactionRequestBuilder::new().build_pay_to_id(
        payment,
        NoteType::Public,
        client.rng(),
    )?;
    let transfer_note_id = request.expected_output_own_notes()[0].id();
    client.submit_tutorial_transaction(alice, request).await?;
    let transfer_notes = wait_for_notes_by_id(&mut client, &[transfer_note_id]).await?;
    assert_eq!(transfer_notes.len(), 1);
    assert_eq!(
        transfer_notes[0]
            .assets()
            .iter()
            .copied()
            .collect::<Vec<_>>(),
        vec![asset]
    );
    assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
    assert_eq!(client.get_account_vault(bob).await?.get(nft.id()), None);
    println!("In transit: one NFT in Bob's P2ID note; neither wallet owns it.");

    // 7. Bob consumes the transfer note; fresh vault reads verify ownership.
    let request = TransactionRequestBuilder::new().build_consume_notes(transfer_notes)?;
    client.submit_tutorial_transaction(bob, request).await?;
    assert_eq!(
        client.get_account_vault(bob).await?.get(nft.id()),
        Some(asset)
    );
    assert_eq!(client.get_account_vault(alice).await?.get(nft.id()), None);
    assert_eq!(
        client.get_account_vault(faucet.id()).await?.get(nft.id()),
        None
    );
    assert!(client
        .get_input_note(transfer_note_id)
        .await?
        .unwrap()
        .is_consumed());
    println!("Complete: Bob owns the NFT; Alice does not. Both NFT notes are consumed.");
    Ok(())
}
```

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
TUTORIAL_NETWORK=testnet yarn tutorials --rust=nft_mint_transfer
```

The runner creates a fresh store and keystore for each attempt. The shared helpers fund native transaction fees, synchronize state, and wait for commitment. The NFT is a separate asset from the native tokens used for fees.

### Expected output

Alongside funding messages, account IDs, and committed transaction IDs, a successful run prints these ownership checkpoints:

```text
Minted: one NFT in Alice's P2ID note; neither wallet owns it yet.
Consumed: Alice owns the NFT; Bob does not.
In transit: one NFT in Bob's P2ID note; neither wallet owns it.
Complete: Bob owns the NFT; Alice does not. Both NFT notes are consumed.
```

The account IDs, NFT commitment, and transaction IDs change on each run. The final line appears only after the ownership and consumed-note assertions pass.

### Continue learning

Next tutorial: [Deploying a Counter Contract](./counter_contract_tutorial.md).

For the fungible-asset flow, see [Mint, Consume, and Create Notes](./mint_consume_create_tutorial.md).
