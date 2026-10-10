use rust_client::TutorialClientExt;
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{
            AccountComponentMetadata, AuthNetworkAccount, BasicConstantFeePolicy, BasicWallet,
            FeePolicy, FeePolicyManager,
        },
        AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
    },
    asset::AssetAmount,
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{
        NetworkAccountTarget, Note, NoteAssets, NoteAttachments, NoteError, NoteExecutionHint,
        NoteRecipient, NoteStorage, NoteTag, NoteType, P2idNote, PartialNoteMetadata,
    },
    rng::draw_word,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{ExpirationTransactionScript, TransactionRequestBuilder},
    Client, ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::{fund_account_for_fees, FeeConfig, TutorialNetwork};
use tokio::time::{sleep, Duration};

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

    // `include_str!` resolves at compile time relative to this source file,
    // so the binary is independent of the working directory it is run from.
    let counter_code = include_str!("../../../masm/accounts/counter.masm");
    let network_note_code = include_str!("../../../masm/notes/network_increment_note.masm");

    // An account is a *network account* (one the network
    // transaction builder executes on a user's behalf) if and only if it is
    // public AND carries the `AuthNetworkAccount` auth component. That component
    // holds an allowlist of note scripts the network builder may execute.
    // Compile the increment note first so its root can be included at creation.
    let note_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)?
        .compile_note_script(network_note_code)?;
    let note_script_root = note_script.root();

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
