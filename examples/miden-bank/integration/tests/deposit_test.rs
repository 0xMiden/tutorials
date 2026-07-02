use integration::helpers::{
    build_project_in_dir, build_tx_script_from_package, create_testing_account_from_package,
    create_testing_note_from_package, AccountCreationConfig, NoteCreationConfig,
};

use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    auth::AuthSchemeId,
    note::NoteAssets,
    transaction::RawOutputNote,
    Felt, Word,
};
use miden_client::asset::{Asset, FungibleAsset};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Storage slot names for the bank account component.
///
/// The `initialized` value slot has no schema default, so `AccountComponent::from_package`
/// requires it to be seeded via `InitStorageData` (otherwise it errors with
/// `InitValueNotProvided`). The `balances` map slot defaults to empty and needs no entry.
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
async fn deposit_test() -> anyhow::Result<()> {
    // Test that after executing the deposit note, the depositor's balance is updated
    let mut builder = MockChain::builder();

    // Create a faucet to mint test assets
    let faucet = builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        1000,
        Some(10),
    )?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
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

    // Create the bank account. The `initialized` value slot has no schema default, so it must
    // be seeded (here with a zero Word = uninitialized) or `from_package` errors with
    // `InitValueNotProvided`; the `balances` map defaults to empty.
    let (initialized_slot, balances_slot) = bank_storage_slots();
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
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    // *********************************************************************************
    // STEP 1: INITIALIZE THE BANK VIA TX SCRIPT
    // *********************************************************************************
    // The bank must be initialized before deposits are accepted.
    // This is done via a transaction script that calls bank.initialize()

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

    // Create the key for the depositor (sender) in the storage map.
    // Key format: [depositor_prefix, depositor_suffix, asset.key[3], asset.key[2]].
    // In v0.15 the fungible-asset vault key is
    // [asset_id_suffix, asset_id_prefix, faucet_suffix | metadata_byte, faucet_prefix],
    // so `key[2]` is the faucet suffix combined with a metadata byte (composition +
    // callback flag) — not the raw faucet suffix. Derive the read key from the asset's
    // actual key word so it matches the key the contract writes.
    let asset_key_word = FungibleAsset::new(faucet.id(), deposit_amount)?.to_key_word();
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        asset_key_word[3],
        asset_key_word[2],
    ]);

    // Get the depositor's balance from the bank's storage using named slot
    let balance = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;

    // The contract stores `balance` as a `Felt`; reading the map returns the
    // single-Felt value widened into a Word at position [0] ([amount, 0, 0, 0]).
    let expected_balance = Word::from([
        Felt::new_unchecked(deposit_amount),
        Felt::new_unchecked(0),
        Felt::new_unchecked(0),
        Felt::new_unchecked(0),
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
    let faucet = builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        large_amount,
        Some(10),
    )?;

    // Create note sender account (the depositor) with large asset balance
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
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

    // Create the bank account, seeding the required `initialized` value slot (see below).
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
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

    // Build the mock chain
    let mut mock_chain = builder.build()?;

    // Initialize the bank first
    let init_tx_script = build_tx_script_from_package(init_tx_script_package.as_ref())?;

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
    let faucet = builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        1000,
        Some(10),
    )?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
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

    // Create the bank account, seeding the required `initialized` value slot (see below).
    // Note: We intentionally do NOT initialize the bank (initialized stays at 0).
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

    let bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg)?;

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
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

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
