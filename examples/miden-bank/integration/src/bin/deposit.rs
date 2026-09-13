//! Deposit to Bank Account Binary
//!
//! This binary deposits assets into an existing bank account on the Miden network.
//! The bank account must have been previously created and initialized using the
//! `initialize` binary.
//!
//! # Usage
//! ```bash
//! cargo run --bin deposit -- <BANK_ACCOUNT_ID>
//! ```
//!
//! # Arguments
//! * `BANK_ACCOUNT_ID` - The hex ID of the bank account to deposit into
//!
//! # Example
//! ```bash
//! cargo run --bin deposit -- 0x1234567890abcdef...
//! ```

use integration::helpers::{
    build_project_in_dir, create_basic_wallet_account, create_note_from_package, setup_client,
    wait_for_native_funding, wait_for_transaction, AccountCreationConfig, ClientSetup,
    NoteCreationConfig,
};

use anyhow::{bail, Context, Result};
use miden_client::{
    account::{AccountId, StorageMapKey, StorageSlotName},
    asset::FungibleAsset,
    note::NoteAssets,
    transaction::TransactionRequestBuilder,
    Word,
};
use std::{env, path::Path, sync::Arc};

/// Default deposit amount (in base units)
const DEFAULT_DEPOSIT_AMOUNT: u64 = 1000;

#[tokio::main]
async fn main() -> Result<()> {
    println!("=== Miden Bank Deposit ===\n");

    // Parse command line arguments
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        bail!(
            "Usage: {} <BANK_ACCOUNT_ID>\n\n\
             Example: {} 0x1234567890abcdef...\n\n\
             Run 'cargo run --bin initialize' first to get a bank account ID.",
            args[0],
            args[0]
        );
    }

    let bank_account_id_hex = &args[1];
    let bank_account_id = AccountId::from_hex(bank_account_id_hex)
        .context(format!("Invalid bank account ID: {}", bank_account_id_hex))?;

    println!("Target bank account: {}", bank_account_id.to_hex());

    // Initialize client
    let ClientSetup {
        mut client,
        keystore,
    } = setup_client().await?;

    let sync_summary = client.sync_state().await?;
    println!(
        "Connected to network. Latest block: {}",
        sync_summary.block_num
    );

    // Verify the bank account exists in our client
    let bank_account_record = client
        .get_account(bank_account_id)
        .await
        .context("Failed to fetch bank account")?;

    match bank_account_record {
        Some(record) => {
            println!("  ✓ Bank account found: {}", record.id().to_hex());
        }
        None => {
            bail!(
                "Bank account {} not found in client.\n\
                 Make sure you've run 'cargo run --bin initialize' first.",
                bank_account_id.to_hex()
            );
        }
    }

    // Build contracts
    println!("\nBuilding deposit note contract...");
    let deposit_note_package = Arc::new(
        build_project_in_dir(Path::new("../contracts/deposit-note"), true)
            .context("Failed to build deposit note contract")?,
    );
    println!("  ✓ Deposit note contract built");

    // Create the sender account, then receive funding before publishing its deposit.
    println!("\nCreating depositor wallet...");
    let sender_cfg = AccountCreationConfig::default();
    let sender_account = create_basic_wallet_account(&mut client, keystore.clone(), sender_cfg)
        .await
        .context("Failed to create sender wallet account")?;
    println!(
        "  ✓ Depositor wallet created: {}",
        sender_account.id().to_hex()
    );

    wait_for_native_funding(&mut client, sender_account.id(), DEFAULT_DEPOSIT_AMOUNT).await?;

    // Deposit native tokens; the sender also needs enough native tokens to pay fees.
    let faucet_id = client
        .get_latest_block_header()
        .await?
        .fee_parameters()
        .fee_faucet_id();
    let deposit_asset = FungibleAsset::new(faucet_id, DEFAULT_DEPOSIT_AMOUNT)?;
    println!(
        "\nCreating deposit note with {} native base units...",
        DEFAULT_DEPOSIT_AMOUNT
    );
    let deposit_note = create_note_from_package(
        &mut client,
        deposit_note_package.clone(),
        sender_account.id(),
        NoteCreationConfig {
            assets: NoteAssets::new(vec![deposit_asset.into()])?,
            ..Default::default()
        },
    )
    .context("Failed to create deposit note")?;

    println!("  ✓ Deposit note created: {}", deposit_note.id().to_hex());

    // Publish the deposit note
    println!("\nPublishing deposit note...");
    let note_publish_request = TransactionRequestBuilder::new()
        .own_output_notes(vec![deposit_note.clone()])
        .build()
        .context("Failed to build note publish transaction request")?;

    let note_publish_tx_id = client
        .submit_new_transaction(sender_account.id(), note_publish_request)
        .await
        .context("Failed to publish deposit note")?;

    println!("  ✓ Note published: {}", note_publish_tx_id.to_hex());

    wait_for_transaction(&mut client, note_publish_tx_id).await?;

    // Consume the deposit note with the bank account
    println!("\nExecuting deposit (bank consuming the note)...");
    let consume_note_request = TransactionRequestBuilder::new()
        .input_notes([(deposit_note.clone(), None)])
        .build()
        .context("Failed to build consume note transaction request")?;

    let consume_tx_id = client
        .submit_new_transaction(bank_account_id, consume_note_request)
        .await
        .context("Failed to execute deposit transaction")?;

    println!("  ✓ Deposit transaction: {}", consume_tx_id.to_hex());

    wait_for_transaction(&mut client, consume_tx_id).await?;
    let bank = client
        .get_account(bank_account_id)
        .await?
        .context("Bank missing after deposit")?;
    let key = deposit_asset.to_id_word();
    let depositor_key = StorageMapKey::new(Word::from([
        sender_account.id().prefix().as_felt(),
        sender_account.id().suffix(),
        key[3],
        key[2],
    ]));
    let balances_slot = StorageSlotName::new("bank_account::bank::balances")?;
    let balance = bank.storage().get_map_item(&balances_slot, depositor_key)?;
    anyhow::ensure!(
        balance[0].as_canonical_u64() == DEFAULT_DEPOSIT_AMOUNT,
        "Depositor ledger does not match the deposited assets"
    );

    println!("\n=== Deposit Complete ===");
    println!("\nDepositor: {}", sender_account.id().to_hex());
    println!("Bank Account: {}", bank_account_id.to_hex());
    println!("Deposit Note ID: {}", deposit_note.id().to_hex());
    println!("Transaction ID: {}", consume_tx_id.to_hex());

    Ok(())
}
