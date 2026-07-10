use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{AccountComponentMetadata, AuthNetworkAccount, BasicWallet}, AccountBuilder, AccountComponent,
        AccountType, StorageSlot, StorageSlotName,
    },
    address::NetworkId,
    auth::{AuthSchemeId, AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    crypto::FeltRng,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, PartialNoteMetadata,
    },
    rpc::{Endpoint, GrpcClient},
    store::TransactionFilter,
    transaction::{
        TransactionId, TransactionRequestBuilder, TransactionStatus,
    },
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
    let counter_code = include_str!("../../../masm/accounts/counter.masm");
    let script_code = include_str!("../../../masm/scripts/counter_script.masm");
    let network_note_code = include_str!("../../../masm/notes/network_increment_note.masm");

    // In protocol v0.15 an account is a *network account* (one the network
    // transaction builder executes on a user's behalf) if and only if it is
    // public AND carries the `AuthNetworkAccount` auth component. That component
    // holds two allowlists, both fixed at account creation:
    //   * the note-script allowlist: its presence is what marks the account as a
    //     network account, and the builder only executes notes whose script root
    //     is listed here;
    //   * the tx-script allowlist: the network auth procedure rejects any custom
    //     tx script whose root is not listed, so the STEP 3 deploy script must be
    //     in it.
    // We therefore compile the note script and the deploy tx script now and feed
    // their MAST roots into the allowlists below. Both compiled scripts are reused
    // as-is in STEP 3 (tx script) and STEP 4 (note script) — nothing is compiled
    // twice.
    let note_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)?
        .compile_note_script(network_note_code)?;
    let note_script_root = note_script.root();

    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)?
        .compile_tx_script(script_code)?;
    let tx_script_root = tx_script.root();

    // Compile the counter MASM into an account component
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let component_code = client
        .code_builder()
        .compile_component_code("external_contract::counter_contract", counter_code)?;
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

    // Build the network account: public + `AuthNetworkAccount` with the note-script
    // root allowlisted (this is what makes it a network account) and the deploy
    // tx-script root allowlisted (so the auth procedure accepts the STEP 3 deploy).
    let network_auth = AuthNetworkAccount::with_allowed_notes(BTreeSet::from([note_script_root]))?
        .with_allowed_tx_scripts(BTreeSet::from([tx_script_root]));
    let counter_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_auth_component(network_auth)
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

    // Reuse the `tx_script` compiled in STEP 2 (its root is allowlisted on the
    // account, so the network auth procedure accepts this deploy transaction).
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

    // Create and submit the network note that will increment the counter
    // Generate a random serial number for the note
    let serial_num = client.rng().draw_word();

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

    let mut last_val = None;
    for _ in 0..10 {
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
