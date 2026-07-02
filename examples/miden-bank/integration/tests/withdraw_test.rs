use integration::helpers::{
    build_project_in_dir, build_tx_script_from_package, create_testing_account_from_package,
    create_testing_note_from_package, AccountCreationConfig, NoteCreationConfig,
};

use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    auth::AuthSchemeId,
    note::{Note, NoteAssets, NoteTag, NoteType, P2idNote, P2idNoteStorage, PartialNoteMetadata},
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_client::asset::{Asset, FungibleAsset};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Storage slot names for the bank account component. The `initialized` value slot must be
/// seeded via `InitStorageData` (no schema default); the `balances` map defaults to empty.
fn bank_storage_slots() -> (StorageSlotName, StorageSlotName) {
    let initialized_slot =
        StorageSlotName::new("bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("bank_account::bank::balances")
            .expect("Valid slot name");
    (initialized_slot, balances_slot)
}

#[tokio::test]
async fn withdraw_test() -> anyhow::Result<()> {
    // *********************************************************************************
    // SETUP
    // *********************************************************************************

    // Test that after executing the deposit note, the depositor's balance is updated
    let mut builder = MockChain::builder();

    // Define the deposit amount
    let deposit_amount: u64 = 1000;

    // Create a faucet to mint test assets
    let faucet = builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        deposit_amount,
        Some(10),
    )?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        [FungibleAsset::new(faucet.id(), deposit_amount)?.into()],
    )?;

    // Build contracts
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);
    let deposit_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/deposit-note"),
        true,
    )?);
    let init_tx_script_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/init-tx-script"),
        true,
    )?);

    // Create the bank account. The `initialized` value slot has no schema default, so it must
    // be seeded (here with a zero Word = uninitialized) or `from_package` errors with
    // `InitValueNotProvided`; the `balances` map defaults to empty.
    let (initialized_slot, _balances_slot) = bank_storage_slots();
    let bank_cfg = AccountCreationConfig {
        init_storage_data: {
            let mut data = InitStorageData::default();
            data.insert_value(
                StorageValueName::from_slot_name(&initialized_slot),
                Word::default(),
            )?;
            data
        },
        ..Default::default()
    };

    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg)?;

    // *********************************************************************************
    // STEP 1: CRAFT DEPOSIT NOTE
    // *********************************************************************************

    // Create a fungible asset to deposit
    let fungible_asset = FungibleAsset::new(faucet.id(), deposit_amount)?;
    let note_assets = NoteAssets::new(vec![Asset::Fungible(fungible_asset)])?;

    // Create the deposit note with assets attached
    // The sender becomes the depositor
    let deposit_note = create_testing_note_from_package(
        deposit_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            assets: note_assets,
            ..Default::default()
        },
    )?;

    // Add bank account and deposit note to mockchain
    builder.add_account(bank_account.clone())?;
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

    // *********************************************************************************
    // STEP 2: CRAFT WITHDRAW REQUEST NOTE
    // *********************************************************************************

    let withdraw_amount = deposit_amount / 2;

    // Compute proper P2ID tag for the sender (depositor) who will consume the output note
    let p2id_tag = NoteTag::with_account_target(sender.id());
    let p2id_tag_felt = Felt::new_unchecked(p2id_tag.as_u32() as u64);

    println!("Computed P2ID tag for sender: 0x{:08X}", p2id_tag.as_u32());

    // Random serial number - MUST be unique per note
    // In production, this would be generated randomly. For testing, we use fixed values.
    let p2id_output_note_serial_num = Word::from([
        Felt::new_unchecked(0x1234567890abcdef),
        Felt::new_unchecked(0xfedcba0987654321),
        Felt::new_unchecked(0xdeadbeefcafebabe),
        Felt::new_unchecked(0x0123456789abcdef),
    ]);

    println!("Serial num (random): {:?}", p2id_output_note_serial_num);

    // Note type for the P2ID output note
    let note_type_felt = Felt::new_unchecked(1); // 1 = Public note (stored on-chain)

    // Get the P2ID script root (Poseidon2-hashed MAST root). `script_root()` returns
    // a `NoteScriptRoot` in v0.15; convert to a `Word` so its felts can be indexed.
    let p2id_script_root = Word::from(P2idNote::script_root());

    // Note storage layout (14 Felts):
    // [0-3]: withdraw asset encoded as [amount, 0, asset.key[2] (faucet suffix + metadata byte), asset.key[3] (faucet prefix)]
    // [4-7]: serial_num (random/unique per note)
    // [8]: tag (P2ID note tag for routing)
    // [9]: note_type (1 = Public, 2 = Private)
    // [10-13]: P2ID script_root (MAST root for recipient computation)
    // In v0.15 the fungible-asset vault key encodes the faucet suffix together with a
    // metadata byte at index [2] (and the faucet prefix at [3]). Encode the asset from the
    // asset's real key word so the bank reconstructs the same key it deposited under.
    let withdraw_asset_key_word = FungibleAsset::new(faucet.id(), withdraw_amount)?.to_key_word();
    let withdraw_request_note_storage = vec![
        // WITHDRAW ASSET ENCODING
        Felt::new_unchecked(withdraw_amount),
        Felt::new_unchecked(0),
        withdraw_asset_key_word[2],
        withdraw_asset_key_word[3],
        // P2ID OUTPUT NOTE SERIAL NUMBER (random, unique per note)
        p2id_output_note_serial_num[0],
        p2id_output_note_serial_num[1],
        p2id_output_note_serial_num[2],
        p2id_output_note_serial_num[3],
        // TAG (directly passed, no advice provider needed)
        p2id_tag_felt,
        // NOTE TYPE (1 = Public)
        note_type_felt,
        // P2ID SCRIPT ROOT (4 Felts)
        p2id_script_root[0],
        p2id_script_root[1],
        p2id_script_root[2],
        p2id_script_root[3],
    ];

    let withdraw_request_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/withdraw-request-note"),
        true,
    )?);

    let withdraw_request_note = create_testing_note_from_package(
        withdraw_request_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            storage: withdraw_request_note_storage,
            ..Default::default()
        },
    )?;

    builder.add_output_note(RawOutputNote::Full(withdraw_request_note.clone()));

    // *********************************************************************************
    // STEP 3: INITIALIZE THE BANK VIA TX SCRIPT
    // *********************************************************************************
    // The bank must be initialized before deposits are accepted.

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    let init_tx_script = build_tx_script_from_package(init_tx_script_package.as_ref())?;

    let init_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[], &[])?
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    bank_account.apply_delta(&executed_init.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;

    println!("Bank initialized successfully");

    // *********************************************************************************
    // STEP 4: MAKE DEPOSIT
    // *********************************************************************************

    // Build the transaction context where bank consumes the deposit note
    let deposit_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    // Execute the transaction
    let executed_deposit_transaction = deposit_tx_context.execute().await?;

    // Apply the account delta to the bank account
    bank_account.apply_delta(&executed_deposit_transaction.account_delta())?;

    // Add the executed transaction to the mockchain and prove
    mock_chain.add_pending_executed_transaction(&executed_deposit_transaction)?;
    mock_chain.prove_next_block()?;

    println!("Bank deposit successful");

    // *********************************************************************************
    // STEP 5: MAKE WITHDRAW
    // *********************************************************************************

    // Create expected P2ID output note with the computed tag
    let recipient = P2idNoteStorage::new(sender.id()).into_recipient(p2id_output_note_serial_num);
    let p2id_output_note_asset = FungibleAsset::new(faucet.id(), withdraw_amount)?;
    let p2id_output_note_assets = NoteAssets::new(vec![p2id_output_note_asset.into()])?;
    let p2id_output_note_metadata = PartialNoteMetadata::new(bank_account.id(), NoteType::Public)
        .with_tag(p2id_tag);

    println!("Recipient digest: {:?}", recipient.digest().to_hex());

    let p2id_output_note = Note::new(
        p2id_output_note_assets,
        p2id_output_note_metadata,
        recipient,
    );

    let withdraw_request_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[withdraw_request_note.id()], &[])?
        .extend_expected_output_notes(vec![RawOutputNote::Full(p2id_output_note)])
        .build()?;

    let executed_withdraw_request_transaction = withdraw_request_tx_context.execute().await?;

    bank_account.apply_delta(&executed_withdraw_request_transaction.account_delta())?;

    mock_chain.add_pending_executed_transaction(&executed_withdraw_request_transaction)?;
    mock_chain.prove_next_block()?;

    println!("Withdraw test passed!");

    Ok(())
}
