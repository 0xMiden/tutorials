use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, create_testing_note_from_package,
    AccountCreationConfig, NoteCreationConfig,
};

use miden_client::{
    account::{StorageMap, StorageSlot, StorageSlotName},
    note::NoteAssets,
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
async fn deposit_test() -> anyhow::Result<()> {
    // Test that after executing the deposit note, the depositor's balance is updated
    let mut builder = MockChain::builder();

    // Create a faucet to mint test assets
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth, "TEST", 1000, Some(10))?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth,
        [FungibleAsset::new(faucet.id(), 100)?.into()],
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
    let (_initialized_slot, balances_slot, storage_slots) = bank_storage_slots();
    let bank_cfg = AccountCreationConfig {
        storage_slots,
        ..Default::default()
    };

    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg).await?;

    // Create a fungible asset to deposit
    let deposit_amount: u64 = 1000;
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

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    // *********************************************************************************
    // STEP 1: INITIALIZE THE BANK VIA TX SCRIPT
    // *********************************************************************************
    // The bank must be initialized before deposits are accepted.
    // This is done via a transaction script that calls bank.initialize()

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
    // STEP 2: DEPOSIT
    // *********************************************************************************

    // Build the transaction context where bank consumes the deposit note
    let tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    // Execute the transaction
    let executed_transaction = tx_context.execute().await?;

    // Apply the account delta to the bank account
    bank_account.apply_delta(&executed_transaction.account_delta())?;

    // Add the executed transaction to the mockchain and prove
    mock_chain.add_pending_executed_transaction(&executed_transaction)?;
    mock_chain.prove_next_block()?;

    // Create the key for the depositor (sender) in the storage map
    // Key format: [prefix, suffix, faucet_prefix, faucet_suffix]
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        faucet.id().prefix().as_felt(),
        faucet.id().suffix(),
    ]);

    // Get the depositor's balance from the bank's storage using named slot
    let balance = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;

    // The balance should be stored as [amount, 0, 0, 0] in the Word
    // But since we store just the Felt, check the first element
    let expected_balance = Word::from([
        Felt::new(0),
        Felt::new(0),
        Felt::new(0),
        Felt::new(deposit_amount),
    ]);

    assert_eq!(
        balance, expected_balance,
        "Depositor balance should equal the deposited amount"
    );

    println!("Deposit test passed! Deposited {} tokens", deposit_amount);
    Ok(())
}

/// Test that deposits exceeding MAX_DEPOSIT_AMOUNT (1,000,000) are rejected.
///
/// The bank account contract enforces a maximum deposit limit. This test verifies
/// that attempting to deposit more than the allowed maximum causes the transaction
/// to fail during execution.
#[tokio::test]
async fn deposit_exceeds_max_should_fail() -> anyhow::Result<()> {
    let mut builder = MockChain::builder();

    // Create a faucet with enough capacity for a large deposit
    // MAX_DEPOSIT_AMOUNT in the contract is 1,000,000
    let large_amount: u64 = 2_000_000; // Exceeds MAX_DEPOSIT_AMOUNT
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth, "TEST", large_amount, Some(10))?;

    // Create note sender account (the depositor) with large asset balance
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth,
        [FungibleAsset::new(faucet.id(), large_amount)?.into()],
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

    // Create a deposit note with amount exceeding the max
    let fungible_asset = FungibleAsset::new(faucet.id(), large_amount)?;
    let note_assets = NoteAssets::new(vec![Asset::Fungible(fungible_asset)])?;

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

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    // Initialize the bank first
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

    // Build the transaction context
    let tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    // Execute should fail due to max deposit constraint
    let result = tx_context.execute().await;

    assert!(
        result.is_err(),
        "Expected transaction to fail due to exceeding max deposit amount, but it succeeded"
    );

    println!(
        "Max deposit constraint test passed - deposit of {} tokens correctly rejected (max is 1,000,000)",
        large_amount
    );
    Ok(())
}

/// Test that deposits fail when the bank has not been initialized.
///
/// The bank must be initialized via a transaction script before deposits
/// can be accepted. This test verifies that attempting to deposit before
/// initialization causes the transaction to fail.
#[tokio::test]
async fn deposit_without_init_should_fail() -> anyhow::Result<()> {
    let mut builder = MockChain::builder();

    // Create a faucet to mint test assets
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth, "TEST", 1000, Some(10))?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth,
        [FungibleAsset::new(faucet.id(), 100)?.into()],
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

    // Create the bank account with named storage slots
    // Note: We intentionally do NOT initialize the bank
    let (_initialized_slot, _balances_slot, storage_slots) = bank_storage_slots();
    let bank_cfg = AccountCreationConfig {
        storage_slots,
        ..Default::default()
    };

    let bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg).await?;

    // Create a deposit note
    let deposit_amount: u64 = 1000;
    let fungible_asset = FungibleAsset::new(faucet.id(), deposit_amount)?;
    let note_assets = NoteAssets::new(vec![Asset::Fungible(fungible_asset)])?;

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

    // Build the mock chain
    let mock_chain = builder.build()?;

    // Try to deposit WITHOUT initializing the bank first
    let tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    // Execute should fail because the bank is not initialized
    let result = tx_context.execute().await;

    assert!(
        result.is_err(),
        "Expected deposit to fail when bank not initialized, but it succeeded"
    );

    println!("Uninitialized deposit correctly rejected - bank must be initialized first");
    Ok(())
}
