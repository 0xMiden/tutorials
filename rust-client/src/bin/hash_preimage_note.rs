use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
        Account, AccountBuilder, AccountType,
    },
    asset::{AssetAmount, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteAssets, NoteRecipient, NoteStorage, NoteTag, NoteType, PartialNoteMetadata},
    rng::draw_word,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{TransactionId, TransactionRequestBuilder},
    Client, ClientError, Felt,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::Hasher;
use rust_client::{fund_account_for_fees, FeeConfig, TutorialNetwork};

// Helper to create a basic account
async fn create_basic_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &Arc<FilesystemKeyStore>,
) -> Result<Account, ClientError> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    client.add_account(&account, false).await?;
    keystore.add_key(&key_pair, account.id()).await.unwrap();

    Ok(account)
}

async fn create_basic_faucet(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &Arc<FilesystemKeyStore>,
) -> Result<Account, ClientError> {
    let mut init_seed = [0u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let symbol = TokenSymbol::new("MID").unwrap();
    let decimals = 8;
    let max_supply = AssetAmount::new(1_000_000).unwrap();

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
    let account = create_singlesig_user_fungible_faucet(
        init_seed,
        faucet,
        AuthSingleSig::from_public_key(key_pair.public_key()),
        policies,
        AccountType::Public,
    )
    .unwrap();

    client.add_account(&account, false).await?;
    keystore.add_key(&key_pair, account.id()).await.unwrap();

    Ok(account)
}

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

    // -------------------------------------------------------------------------
    // STEP 1: Create accounts and deploy faucet
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating new accounts");
    let alice_account = create_basic_account(&mut client, &keystore).await?;
    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(network.network_id())
    );
    let bob_account = create_basic_account(&mut client, &keystore).await?;
    println!(
        "Bob's account ID: {:?}",
        bob_account.id().to_bech32(network.network_id())
    );

    println!("\nDeploying a new fungible faucet.");
    let faucet = create_basic_faucet(&mut client, &keystore).await?;
    println!(
        "Faucet account ID: {:?}",
        faucet.id().to_bech32(network.network_id())
    );
    for account_id in [alice_account.id(), bob_account.id(), faucet.id()] {
        fund_account_for_fees(&mut client, account_id, &fee_config).await?;
    }
    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 2: Mint tokens with P2ID
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Mint tokens with P2ID");
    let faucet_id = faucet.id();
    let amount: u64 = 100;
    let mint_amount = FungibleAsset::new(faucet_id, amount).unwrap();
    let tx_request = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(
            mint_amount,
            alice_account.id(),
            NoteType::Public,
            client.rng(),
        )
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(faucet.id(), tx_request)
        .await?;
    println!("Minted tokens. TX: {:?}", tx_id);

    // Wait for the note to be available
    client.sync_state().await?;
    wait_for_tx(&mut client, tx_id).await?;

    // Consume the minted note
    let consumable_notes = client
        .get_consumable_tutorial_notes(Some(alice_account.id()))
        .await?;

    if let Some((note_record, _)) = consumable_notes.first() {
        let note: Note = note_record.clone().try_into()?;
        let consume_request = TransactionRequestBuilder::new().build_consume_notes(vec![note])?;

        let tx_id = client
            .submit_tutorial_transaction(alice_account.id(), consume_request)
            .await?;
        println!("Consumed minted note. TX: {:?}", tx_id);
    }

    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 3: Create custom note
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Create custom note");
    let secret_vals = vec![
        Felt::new_unchecked(1),
        Felt::new_unchecked(2),
        Felt::new_unchecked(3),
        Felt::new_unchecked(4),
    ];
    let digest = Hasher::hash_elements(&secret_vals);
    println!("digest: {:?}", digest);

    // `include_str!` resolves at compile time relative to this source file,
    // so the binary is independent of the working directory it is run from.
    let code = include_str!("../../../masm/notes/hash_preimage_note.masm");
    let serial_num = draw_word(client.rng());

    let note_script = client.code_builder().compile_note_script(code).unwrap();
    let note_storage = NoteStorage::new(digest.to_vec()).unwrap();
    let recipient = NoteRecipient::new(serial_num, note_script, note_storage);
    let tag = NoteTag::new(0);
    let metadata = PartialNoteMetadata::new(alice_account.id(), NoteType::Public).with_tag(tag);
    let vault = NoteAssets::new(vec![mint_amount.into()])?;
    let custom_note = Note::new(vault, metadata, recipient);
    println!("note hash: {:?}", custom_note.id().to_hex());

    let note_request = TransactionRequestBuilder::new()
        .own_output_notes(vec![custom_note.clone()])
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(alice_account.id(), note_request)
        .await?;
    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 4: Consume the Custom Note
    // -------------------------------------------------------------------------
    println!("\n[STEP 4] Bob consumes the Custom Note with Correct Secret");

    let secret = [
        Felt::new_unchecked(1),
        Felt::new_unchecked(2),
        Felt::new_unchecked(3),
        Felt::new_unchecked(4),
    ];
    let consume_custom_request = TransactionRequestBuilder::new()
        .input_notes([(custom_note, Some(secret.into()))])
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(bob_account.id(), consume_custom_request)
        .await?;
    println!(
        "Consumed Note Tx on MidenScan: {}/tx/{:?} \n",
        network.explorer_url(),
        tx_id
    );

    wait_for_tx(&mut client, tx_id).await?;

    let bob = client
        .get_account(bob_account.id())
        .await?
        .expect("Bob's account must exist after consuming the note");
    let balance = bob.vault().get_balance(AssetId::new_fungible(faucet_id))?;
    assert_eq!(
        balance.as_u64(),
        amount,
        "Bob must receive all assets from the hash-preimage note",
    );
    println!("Bob's custom-note token balance: {balance}");

    Ok(())
}
