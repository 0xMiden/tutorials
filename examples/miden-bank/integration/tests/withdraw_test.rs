use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, create_testing_note_from_package,
    AccountCreationConfig, NoteCreationConfig,
};

use miden_client::{
    account::{StorageMap, StorageSlot, StorageSlotName},
    note::{build_p2id_recipient, Note, NoteAssets, NoteMetadata, NoteTag, NoteType},
    transaction::{OutputNote, TransactionScript},
    Felt, Word,
};
use miden_client::asset::{Asset, FungibleAsset};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Helper to create the bank account storage slots with named slot names
fn bank_storage_slots() -> (StorageSlotName, StorageSlotName, Vec<StorageSlot>) {
    let initialized_slot =
        StorageSlotName::new("miden::component::miden_bank_account::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden::component::miden_bank_account::balances")
            .expect("Valid slot name");

    let slots = vec![
        StorageSlot::with_value(initialized_slot.clone(), Word::default()),
        StorageSlot::with_map(
            balances_slot.clone(),
            StorageMap::with_entries([]).expect("Empty storage map"),
        ),
    ];

    (initialized_slot, balances_slot, slots)
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
    let faucet =
        builder.add_existing_basic_faucet(Auth::BasicAuth, "TEST", deposit_amount, Some(10))?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth,
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

    // Create the bank account with named storage slots
    let (_initialized_slot, _balances_slot, storage_slots) = bank_storage_slots();
    let bank_cfg = AccountCreationConfig {
        storage_slots,
        ..Default::default()
    };

    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg).await?;

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
    builder.add_output_note(OutputNote::Full(deposit_note.clone()));

    // *********************************************************************************
    // STEP 2: CRAFT WITHDRAW REQUEST NOTE
    // *********************************************************************************

    let withdraw_amount = deposit_amount / 2;

    // Compute proper P2ID tag for the sender (depositor) who will consume the output note
    let p2id_tag = NoteTag::with_account_target(sender.id());
    let p2id_tag_felt = Felt::new(p2id_tag.as_u32() as u64);

    println!("Computed P2ID tag for sender: 0x{:08X}", p2id_tag.as_u32());

    // Random serial number - MUST be unique per note
    // In production, this would be generated randomly. For testing, we use fixed values.
    let p2id_output_note_serial_num = Word::from([
        Felt::new(0x1234567890abcdef),
        Felt::new(0xfedcba0987654321),
        Felt::new(0xdeadbeefcafebabe),
        Felt::new(0x0123456789abcdef),
    ]);

    println!("Serial num (random): {:?}", p2id_output_note_serial_num);

    // Note type for the P2ID output note
    let note_type_felt = Felt::new(1); // 1 = Public note (stored on-chain)

    // Note inputs layout (10 Felts):
    // [0-3]: withdraw asset (amount, 0, faucet_suffix, faucet_prefix)
    // [4-7]: serial_num (random/unique per note)
    // [8]: tag (P2ID note tag for routing)
    // [9]: note_type (1 = Public, 2 = Private)
    let withdraw_request_note_inputs = vec![
        // WITHDRAW ASSET WORD
        Felt::new(withdraw_amount),
        Felt::new(0),
        faucet.id().suffix(),
        faucet.id().prefix().as_felt(),
        // P2ID OUTPUT NOTE SERIAL NUMBER (random, unique per note)
        p2id_output_note_serial_num[0],
        p2id_output_note_serial_num[1],
        p2id_output_note_serial_num[2],
        p2id_output_note_serial_num[3],
        // TAG (directly passed, no advice provider needed)
        p2id_tag_felt,
        // NOTE TYPE (1 = Public)
        note_type_felt,
    ];

    let withdraw_request_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/withdraw-request-note"),
        true,
    )?);

    let withdraw_request_note = create_testing_note_from_package(
        withdraw_request_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            inputs: withdraw_request_note_inputs,
            ..Default::default()
        },
    )?;

    builder.add_output_note(OutputNote::Full(withdraw_request_note.clone()));

    // *********************************************************************************
    // STEP 3: INITIALIZE THE BANK VIA TX SCRIPT
    // *********************************************************************************
    // The bank must be initialized before deposits are accepted.

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new((*init_program).clone());

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
    let recipient = build_p2id_recipient(sender.id(), p2id_output_note_serial_num)?;
    let p2id_output_note_asset = FungibleAsset::new(faucet.id(), withdraw_amount)?;
    let p2id_output_note_assets = NoteAssets::new(vec![p2id_output_note_asset.into()])?;
    let p2id_output_note_metadata = NoteMetadata::new(
        bank_account.id(),
        NoteType::Public,
        p2id_tag,
    );

    println!("Recipient digest: {:?}", recipient.digest().to_hex());

    let p2id_output_note = Note::new(
        p2id_output_note_assets,
        p2id_output_note_metadata,
        recipient,
    );

    let withdraw_request_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[withdraw_request_note.id()], &[])?
        .extend_expected_output_notes(vec![OutputNote::Full(p2id_output_note)])
        .build()?;

    let executed_withdraw_request_transaction = withdraw_request_tx_context.execute().await?;

    bank_account.apply_delta(&executed_withdraw_request_transaction.account_delta())?;

    mock_chain.add_pending_executed_transaction(&executed_withdraw_request_transaction)?;
    mock_chain.prove_next_block()?;

    println!("Withdraw test passed!");

    Ok(())
}
