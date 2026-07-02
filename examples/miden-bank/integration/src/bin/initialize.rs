//! Initialize Bank Account Binary
//!
//! This binary creates and initializes a bank account on the Miden network.
//! After initialization, the bank account ID is printed and can be used
//! with the deposit binary.
//!
//! # Usage
//! ```bash
//! cargo run --bin initialize
//! ```
//!
//! # Output
//! Prints the bank account ID that should be used for subsequent deposits.

use integration::helpers::{
    build_project_in_dir, build_tx_script_from_package, create_account_from_package,
    create_basic_wallet_account, setup_client, AccountCreationConfig, ClientSetup,
};

use anyhow::{Context, Result};
use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    transaction::TransactionRequestBuilder,
    Word,
};
use std::{path::Path, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    println!("=== Miden Bank Initialization ===\n");

    // Initialize client
    let ClientSetup {
        mut client,
        keystore,
    } = setup_client().await?;

    let sync_summary = client.sync_state().await?;
    println!("Connected to network. Latest block: {}", sync_summary.block_num);

    // Build contracts
    println!("\nBuilding contracts...");
    let bank_package = Arc::new(
        build_project_in_dir(Path::new("../contracts/bank-account"), true)
            .context("Failed to build bank account contract")?,
    );
    println!("  ✓ Bank account contract built");

    let init_tx_script_package = Arc::new(
        build_project_in_dir(Path::new("../contracts/init-tx-script"), true)
            .context("Failed to build init transaction script")?,
    );
    println!("  ✓ Init transaction script built");

    // Create the bank account. The `initialized` value slot has no schema default, so it must
    // be seeded (here with a zero Word = uninitialized) or `from_package` errors with
    // `InitValueNotProvided`; the `balances` map defaults to empty.
    println!("\nCreating bank account...");
    let initialized_slot = StorageSlotName::new("bank_account::bank::initialized")
        .context("Valid slot name")?;
    let mut init_storage_data = InitStorageData::default();
    init_storage_data.insert_value(
        StorageValueName::from_slot_name(&initialized_slot),
        Word::default(),
    )?;
    let bank_cfg = AccountCreationConfig {
        init_storage_data,
        ..Default::default()
    };

    let bank_account = create_account_from_package(&mut client, bank_package.clone(), bank_cfg)
        .await
        .context("Failed to create bank account")?;

    println!("  ✓ Bank account created");
    println!("  Bank Account ID: {}", bank_account.id().to_hex());

    // Create a sender account to execute the init transaction
    // (The bank account itself uses NoAuth, so we need a separate authenticated account)
    println!("\nCreating admin wallet for initialization...");
    let admin_cfg = AccountCreationConfig::default();
    let admin_account = create_basic_wallet_account(&mut client, keystore.clone(), admin_cfg)
        .await
        .context("Failed to create admin wallet account")?;
    println!("  ✓ Admin wallet created: {}", admin_account.id().to_hex());

    // Build and execute the initialization transaction
    println!("\nInitializing bank account...");

    let init_tx_script = build_tx_script_from_package(init_tx_script_package.as_ref())?;

    // Build transaction request with the init script
    // The script will call bank_account.initialize()
    let init_request = TransactionRequestBuilder::new()
        .custom_script(init_tx_script)
        .build()
        .context("Failed to build init transaction request")?;

    // Submit the initialization transaction from the bank account
    let init_tx_id = client
        .submit_new_transaction(bank_account.id(), init_request)
        .await
        .context("Failed to submit init transaction")?;

    println!("  ✓ Init transaction submitted: {}", init_tx_id.to_hex());

    // Sync to confirm the transaction
    client
        .sync_state()
        .await
        .context("Failed to sync state after initialization")?;

    println!("\n=== Initialization Complete ===");
    println!("\nBank Account ID (use this for deposits):");
    println!("  {}", bank_account.id().to_hex());
    println!("\nTo make a deposit, run:");
    println!("  cargo run --bin deposit -- {}", bank_account.id().to_hex());

    Ok(())
}
