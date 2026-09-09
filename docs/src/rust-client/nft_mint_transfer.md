---
title: "Mint and Transfer an NFT"
sidebar_position: 4
---

# Mint and Transfer an NFT

Create an NFT collection, mint one NFT to Alice, and transfer it to Bob. Both wallets and the faucet use signature authentication. This recipe uses the standard `NonFungibleFaucet`, `MintNote`, and P2ID note implementations.

## Run the recipe

Clone this repository and follow the [v0.16 Rust setup](./index.md#running-the-v016-examples). From the repository root, run:

```bash
yarn tutorials --rust=nft_mint_transfer
```

The default network is testnet. To validate against devnet, use `TUTORIAL_NETWORK=devnet yarn tutorials --rust=nft_mint_transfer`. The runner creates a fresh store and keystore for each attempt. The shared helpers fund native transaction fees, synchronize state, and wait for commitment; the NFT itself is a separate asset.

## What gets minted

The collection's name and symbol describe its faucet. The individual NFT's value is computed off-chain with `NonFungibleFaucet::compute_asset_commitment(metadata, salt)`: hash the exact metadata bytes, then merge that digest with a random salt. This example keeps the bytes and salt in memory. Applications that need later verification must retain and share them off-chain.

**This commitment is a convention.** The faucet does not validate metadata, a salt, the hash construction, or knowledge of a preimage. A recipient who wants to verify metadata must recompute the commitment and compare it with the asset value. The faucet enforces uniqueness of the token ID derived from the value's first two field elements, not the truth of the metadata.

Alice first publishes an **assetless MINT request**. The faucet signs a transaction consuming it, which creates an **NFT-bearing P2ID note** for Alice. Consuming that P2ID note places the NFT in Alice's vault. Her transfer removes it from her vault and puts it in a new P2ID note; Bob owns it in his vault only after consuming that note.

The faucet combines the standard user-faucet components with `BasicWallet` for fee funding and `CodeInspection` so MINT can identify the faucet kind. Its `allow_all` mint policy accepts the example's value, while `AuthSingleSig` still requires the faucet's signature. No custom MASM is needed.

## Complete example

This is the full source of `rust-client/src/bin/nft_mint_transfer.rs`. The documentation test compiles it, and a consistency test keeps it identical to the executable.

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

## Verify ownership

The program waits for committed transactions and asserts the exact NFT value at each stage:

| Stage          | Alice's vault | Unconsumed NFT note | Bob's vault |
| -------------- | ------------- | ------------------- | ----------- |
| Minted         | Empty         | Addressed to Alice  | Empty       |
| Alice consumed | Holds NFT     | None                | Empty       |
| Alice sent     | Empty         | Addressed to Bob    | Empty       |
| Bob consumed   | Empty         | None                | Holds NFT   |

Fee notes are excluded by selecting only the request, mint, and transfer note IDs. The final assertions check that both NFT-bearing notes were consumed, Bob holds the original asset, and Alice and the faucet do not.

To compare with fungible transfers, see [Mint, Consume, and Create Notes](./mint_consume_create_tutorial.md).
