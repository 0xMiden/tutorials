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
    build_project_in_dir, create_account_from_package, create_basic_wallet_account,
    setup_client, AccountCreationConfig, ClientSetup,
};

use anyhow::{Context, Result};
use miden_client::{
    account::{StorageMap, StorageSlot, StorageSlotName},
    transaction::{TransactionRequestBuilder, TransactionScript},
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

    // Create the bank account with named storage slots:
    // - initialized: Value (starts as 0)
    // - balances: StorageMap
    println!("\nCreating bank account...");
    let initialized_slot =
        StorageSlotName::new("miden::component::miden_bank_account::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden::component::miden_bank_account::balances")
            .expect("Valid slot name");

    let bank_cfg = AccountCreationConfig {
        storage_slots: vec![
            StorageSlot::with_value(initialized_slot, Word::default()),
            StorageSlot::with_map(
                balances_slot,
                StorageMap::with_entries([])
                    .context("Failed to create empty storage map")?,
            ),
        ],
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

    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new((*init_program).clone());

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
