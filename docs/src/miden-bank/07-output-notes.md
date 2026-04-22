---
sidebar_position: 7
title: "Part 7: Creating Output Notes"
description: "Learn how to create output notes programmatically within account methods, including the P2ID (Pay-to-ID) note pattern for sending assets."
---

# Part 7: Creating Output Notes

In this section, you'll learn how to create output notes from within account methods. We'll implement the full withdrawal logic that creates P2ID (Pay-to-ID) notes to send assets back to depositors.

## What You'll Build in This Part

By the end of this section, you will have:

- Created the `withdraw-request-note` note script project
- Implemented the `withdraw()` method with balance validation
- Implemented `create_p2id_note()` for sending assets
- **Verified withdrawals work** via a MockChain test

## Building on Part 6

In Part 6, you created a transaction script for initialization. Now you'll complete the bank by implementing withdrawals that create output notes:

```text
┌────────────────────────────────────────────────────────────────┐
│                   Complete Bank Flow                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Part 6: Initialize                                            │
│   ┌─────────────────┐    init-tx-script     ┌───────────────┐  │
│   │ Bank (uninit)   │ ──────────────────────▶│ Bank (ready)  │  │
│   └─────────────────┘                        └───────────────┘  │
│                                                                 │
│   Part 4: Deposit                                               │
│   ┌─────────────────┐    deposit-note        ┌───────────────┐  │
│   │ User sends      │ ──────────────────────▶│ Balance += X  │  │
│   │ deposit note    │                        │ Vault += X    │  │
│   └─────────────────┘                        └───────────────┘  │
│                                                                 │
│   Part 7: Withdraw (NEW)                                        │
│   ┌─────────────────┐   withdraw-request     ┌───────────────┐  │
│   │ User sends      │ ──────────────────────▶│ Balance -= X  │  │
│   │ withdraw note   │                        │ Creates P2ID  │  │
│   └─────────────────┘                        │ output note   │  │
│                                              └───────────────┘  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Output Notes Overview

When an account needs to send assets to another account, it creates an **output note**. The note travels through the network until the recipient consumes it.

```text
WITHDRAW FLOW:
┌────────────────┐          ┌────────────────┐          ┌────────────────┐
│ Bank Account   │ creates  │ P2ID Note      │ consumed │ Depositor      │
│                │ ────────▶│ (with assets)  │ ────────▶│ Wallet         │
│ remove_asset() │          │                │          │ receives asset │
└────────────────┘          └────────────────┘          └────────────────┘
```

## The P2ID Note Pattern

P2ID (Pay-to-ID) is a standard note pattern in Miden that sends assets to a specific account:

- **Target account**: Only one account can consume the note
- **Asset transfer**: Assets are transferred on consumption
- **Standard script**: Uses a well-known script from miden-standards

## Step 1: Add Withdraw Method to Bank Account

First, let's add the `withdraw()` method to your bank account. Update `contracts/bank-account/src/lib.rs`:

```rust title="contracts/bank-account/src/lib.rs"
#[component]
impl Bank {
    // ... existing methods (initialize, deposit, get_balance) ...

    /// Withdraw assets back to the depositor.
    ///
    /// Creates a P2ID note that sends the requested asset to the depositor's account.
    ///
    /// # Arguments
    /// * `depositor` - The AccountId of the user withdrawing
    /// * `withdraw_asset` - The fungible asset to withdraw
    /// * `serial_num` - Unique serial number for the P2ID output note
    /// * `tag` - The note tag for the P2ID output note (allows caller to specify routing)
    /// * `note_type` - Note type: 1 = Public (stored on-chain), 2 = Private (off-chain)
    ///
    /// # Panics
    /// Panics if the withdrawal amount exceeds the depositor's current balance.
    /// Panics if the bank has not been initialized.
    pub fn withdraw(
        &mut self,
        depositor: AccountId,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        // Ensure the bank is initialized before processing withdrawals
        self.require_initialized();

        // Extract the fungible amount from the asset value word
        let withdraw_amount = withdraw_asset.value[0];

        // Create key from depositor's AccountId and asset faucet ID
        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            withdraw_asset.key[3], // faucet_prefix
            withdraw_asset.key[2], // faucet_suffix
        ]);

        // Get current balance and validate sufficient funds exist.
        // This check is critical: Felt arithmetic is modular, so subtracting
        // more than the balance would silently wrap to a large positive number.
        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        // Update balance: current - withdraw_amount
        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        // Read the P2ID script root from the withdraw-request note's storage (items 10-13).
        // This avoids hardcoding a version-specific MAST root constant.
        let storage = active_note::get_storage();
        let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);

        // Create a P2ID note to send the requested asset back to the depositor
        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type, script_root);
    }
}
```

:::danger Critical Security: Balance Validation
Always validate `current_balance >= withdraw_amount` BEFORE subtraction. Miden uses modular field arithmetic - subtracting a larger value silently wraps to a massive positive number!
:::

## Step 2: How the P2ID Script Root is Supplied

Instead of hardcoding a version-specific MAST root constant in the bank contract, the P2ID script root is passed through the withdraw-request note's storage (items 10-13). The `withdraw()` method reads it directly from the active note:

```rust
let storage = active_note::get_storage();
let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);
```

This design keeps the bank contract version-agnostic: callers embed the P2ID script root they want to use into the note storage when they create the withdraw-request note. The test uses `P2idNote::script_root()` from the `miden_client` crate to obtain the correct value at test time.

## Step 3: Implement create_p2id_note

Add the private method that creates the output note:

```rust title="contracts/bank-account/src/lib.rs"
#[component]
impl Bank {
    // ... other methods ...

    /// Create a P2ID (Pay-to-ID) note to send assets to a recipient.
    ///
    /// # Arguments
    /// * `serial_num` - Unique serial number for the note
    /// * `asset` - The asset to include in the note
    /// * `recipient_id` - The AccountId that can consume this note
    /// * `tag` - The note tag (passed by caller to allow proper P2ID routing)
    /// * `note_type` - Note type as Felt: 1 = Public, 2 = Private
    /// * `script_root` - The P2ID note script MAST root (Poseidon2-hashed)
    fn create_p2id_note(
        &mut self,
        serial_num: Word,
        asset: &Asset,
        recipient_id: AccountId,
        tag: Felt,
        note_type: Felt,
        script_root: Word,
    ) {
        // Convert the passed tag Felt to a Tag
        // The caller is responsible for computing the proper P2ID tag
        // (typically with_account_target for the recipient)
        let tag = Tag::from(tag);

        // Convert note_type Felt to NoteType
        // 1 = Public (stored on-chain), 2 = Private (off-chain)
        let note_type = NoteType::from(note_type);

        // Compute the recipient hash from:
        // - serial_num: unique identifier for this note instance
        // - script_root: the P2ID note script's MAST root
        // - storage: the target account ID
        //
        // The P2ID script expects inputs as [suffix, prefix]
        let recipient = note::build_recipient(
            serial_num,
            script_root,
            vec![
                recipient_id.suffix,
                recipient_id.prefix,
            ],
        );

        // Create the output note
        let note_idx = output_note::create(tag, note_type, recipient);

        // Remove the asset from the bank's vault
        native_account::remove_asset(asset.clone());

        // Add the asset to the output note
        output_note::add_asset(asset.clone(), note_idx);
    }
}
```

### Understanding note::build_recipient()

| Parameter     | Description                                |
| ------------- | ------------------------------------------ |
| `serial_num`  | Unique 4-Felt value preventing note reuse  |
| `script_root` | The P2ID script's MAST root digest         |
| `storage`     | Script storage items (account ID for P2ID) |

:::warning Array Ordering
Note the order: `suffix` comes before `prefix`. This is the opposite of how `AccountId` fields are typically accessed. See [Common Pitfalls](https://docs.miden.xyz/builder/tutorials/rust-compiler/pitfalls#array-ordering-rustmasm-reversal) for details.
:::

### Understanding output_note::create()

| Parameter   | Type        | Description                      |
| ----------- | ----------- | -------------------------------- |
| `tag`       | `Tag`       | Routing information for the note |
| `note_type` | `NoteType`  | Public (1) or Private (2)        |
| `recipient` | `Recipient` | Who can consume the note         |

## Step 4: Create the Withdraw Request Note Project

Create the directory structure:

```bash title=">_ Terminal"
mkdir -p contracts/withdraw-request-note/src
```

### Configure Cargo.toml

```toml title="contracts/withdraw-request-note/Cargo.toml"
[package]
name = "withdraw-request-note"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { version = "0.12" }

[package.metadata.component]
package = "miden:withdraw-request-note"

[package.metadata.miden]
project-kind = "note-script"

[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }

[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

### Update Workspace

Add to your root `Cargo.toml`:

```toml title="Cargo.toml"
[workspace]
members = [
    "integration"
]
exclude = [
    "contracts/",
]
resolver = "2"

[workspace.package]
edition = "2021"

[workspace.dependencies]
```

## Step 5: Implement the Withdraw Request Note Script

```rust title="contracts/withdraw-request-note/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the bank account's generated bindings
use crate::bindings::miden::bank_account::bank_account;

/// Withdraw Request Note Script
///
/// When consumed by the Bank account, this note requests a withdrawal and
/// the bank creates a P2ID note to send assets back to the depositor.
///
/// # Flow
/// 1. Note is created by a depositor specifying the withdrawal details
/// 2. Bank account consumes this note
/// 3. Note script reads the sender (depositor) and storage items
/// 4. Calls `bank_account::withdraw(depositor, asset, serial_num, tag, note_type)`
/// 5. Bank updates the depositor's balance
/// 6. Bank reads P2ID script root from storage[10-13] and creates a P2ID output note
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset encoded as [amount, 0, faucet_suffix, faucet_prefix]
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed)
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get the storage items
        let storage = active_note::get_storage();

        // Asset: reconstruct from [amount, 0, faucet_suffix, faucet_prefix] encoding
        let withdraw_asset = Asset::new(
            Word::from([felt!(0), felt!(0), storage[2], storage[3]]),
            Word::from([storage[0], felt!(0), felt!(0), felt!(0)]),
        );

        // Serial number: full 4 Felts (random/unique per note)
        let serial_num = Word::from([storage[4], storage[5], storage[6], storage[7]]);

        // Tag: single Felt for P2ID note routing
        let tag = storage[8];

        // Note type: 1 = Public, 2 = Private
        let note_type = storage[9];

        // Note: P2ID script root (storage[10..13]) is read by the bank account
        // directly from the active note's storage inside bank_account::withdraw.

        // Call the bank account to withdraw the assets
        bank_account::withdraw(depositor, withdraw_asset, serial_num, tag, note_type);
    }
}
```

### Note Storage Layout

The withdraw-request-note uses 14 Felt storage items:

```text
Note Storage (14 Felts):
┌───────────────────────────────────────────────────────────────────────────┐
│ Index │ Value           │ Description                                     │
├───────┼─────────────────┼─────────────────────────────────────────────────┤
│ 0     │ amount          │ Token amount to withdraw                        │
│ 1     │ 0               │ Reserved (always 0 for fungible)                │
│ 2     │ faucet_suffix   │ Faucet ID suffix (identifies asset type)        │
│ 3     │ faucet_prefix   │ Faucet ID prefix (identifies asset type)        │
│ 4-7   │ serial_num      │ Unique ID for the output P2ID note (4 Felts)    │
│ 8     │ tag             │ Note routing tag for P2ID note                  │
│ 9     │ note_type       │ 1 (Public) or 2 (Private)                       │
│ 10-13 │ script_root     │ P2ID script MAST root (Poseidon2-hashed, 4 Felts)│
└───────────────────────────────────────────────────────────────────────────┘
```

:::note Why the Asset is in Inputs
Unlike the deposit note which gets assets from `active_note::get_assets()`, the withdraw request note doesn't carry assets. Instead, the asset to withdraw is specified in the note inputs. The bank then withdraws from its own vault based on these inputs.
:::

## Step 6: Build All Components

Build in dependency order:

```bash title=">_ Terminal"
# 1. Build the account component (generates WIT files)
cd contracts/bank-account
miden build

# 2. Build the withdraw request note
cd ../withdraw-request-note
miden build
```

## Try It: Verify Withdrawals Work

Let's test the complete withdraw flow. This test:

1. Creates a bank account and initializes it
2. Creates a deposit note and processes it
3. Creates a withdraw-request note with the 14-Felt storage layout
4. Processes the withdrawal and verifies a P2ID output note is created

```rust title="integration/tests/part7_withdraw_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, create_testing_note_from_package,
    AccountCreationConfig, NoteCreationConfig,
};
use miden_client::{
    account::{StorageMap, StorageSlotName},
    asset::{Asset, FungibleAsset},
    auth::AuthSchemeId,
    note::{P2idNote, P2idNoteStorage, Note, NoteAssets, NoteMetadata, NoteTag, NoteType},
    transaction::{RawOutputNote, TransactionScript},
    Felt, Word,
};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

#[tokio::test]
async fn test_withdraw_creates_p2id_note() -> anyhow::Result<()> {
    // =========================================================================
    // SETUP
    // =========================================================================
    let mut builder = MockChain::builder();

    let deposit_amount: u64 = 1000;

    // Create faucet and sender (depositor)
    let faucet =
        builder.add_existing_basic_faucet(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, "TEST", deposit_amount, Some(10))?;
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 },
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
    let withdraw_request_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/withdraw-request-note"),
        true,
    )?);

    // Create bank account with named storage slots
    let initialized_slot =
        StorageSlotName::new("miden_bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden_bank_account::bank::balances")
            .expect("Valid slot name");

    let mut init_storage_data = InitStorageData::default();
    init_storage_data.insert_value(
        StorageValueName::from_slot_name(&initialized_slot),
        Word::default(),
    )?;
    let bank_cfg = AccountCreationConfig {
        init_storage_data,
        ..Default::default()
    };
    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg)?;

    // Create deposit note
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

    // Add accounts and notes to builder
    builder.add_account(bank_account.clone())?;
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

    // =========================================================================
    // CRAFT WITHDRAW REQUEST NOTE (14-Felt storage layout)
    // =========================================================================
    let withdraw_amount = deposit_amount / 2;

    // Compute P2ID tag for the sender
    let p2id_tag = NoteTag::with_account_target(sender.id());
    let p2id_tag_felt = Felt::new(p2id_tag.as_u32() as u64);

    // Serial number for output note
    let p2id_output_note_serial_num = Word::from([
        Felt::new(0x1234567890abcdef),
        Felt::new(0xfedcba0987654321),
        Felt::new(0xdeadbeefcafebabe),
        Felt::new(0x0123456789abcdef),
    ]);

    let note_type_felt = Felt::new(1); // Public

    // Get the P2ID script root (Poseidon2-hashed MAST root)
    let p2id_script_root = P2idNote::script_root();

    // Note storage: 14 Felts
    // [0-3]: withdraw asset (amount, 0, faucet_suffix, faucet_prefix)
    // [4-7]: serial_num
    // [8]: tag
    // [9]: note_type
    // [10-13]: P2ID script_root
    let withdraw_request_note_storage = vec![
        Felt::new(withdraw_amount),
        Felt::new(0),
        faucet.id().suffix(),
        faucet.id().prefix().as_felt(),
        p2id_output_note_serial_num[0],
        p2id_output_note_serial_num[1],
        p2id_output_note_serial_num[2],
        p2id_output_note_serial_num[3],
        p2id_tag_felt,
        note_type_felt,
        p2id_script_root[0],
        p2id_script_root[1],
        p2id_script_root[2],
        p2id_script_root[3],
    ];

    let withdraw_request_note = create_testing_note_from_package(
        withdraw_request_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            storage: withdraw_request_note_storage,
            ..Default::default()
        },
    )?;

    builder.add_output_note(RawOutputNote::Full(withdraw_request_note.clone()));

    // =========================================================================
    // EXECUTE: Initialize, Deposit, Withdraw
    // =========================================================================
    let mut mock_chain = builder.build()?;

    // Initialize bank
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

    println!("Step 1: Bank initialized");

    // Process deposit
    let deposit_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;
    let executed_deposit = deposit_tx_context.execute().await?;
    bank_account.apply_delta(&executed_deposit.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_deposit)?;
    mock_chain.prove_next_block()?;

    println!("Step 2: Deposited {} tokens", deposit_amount);

    // Process withdraw with expected P2ID output note
    let recipient = P2idNoteStorage::new(sender.id()).into_recipient(p2id_output_note_serial_num);
    let p2id_output_note_asset = FungibleAsset::new(faucet.id(), withdraw_amount)?;
    let p2id_output_note_assets = NoteAssets::new(vec![p2id_output_note_asset.into()])?;
    let p2id_output_note_metadata = NoteMetadata::new(bank_account.id(), NoteType::Public)
        .with_tag(p2id_tag);
    let p2id_output_note = Note::new(
        p2id_output_note_assets,
        p2id_output_note_metadata,
        recipient,
    );

    let withdraw_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[withdraw_request_note.id()], &[])?
        .extend_expected_output_notes(vec![RawOutputNote::Full(p2id_output_note)])
        .build()?;
    let executed_withdraw = withdraw_tx_context.execute().await?;
    bank_account.apply_delta(&executed_withdraw.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_withdraw)?;
    mock_chain.prove_next_block()?;

    println!("Step 3: Withdrew {} tokens", withdraw_amount);
    println!("\nPart 7 withdraw test passed!");

    Ok(())
}
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_withdraw_creates_p2id_note -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part7_withdraw_test.rs

running 1 test
Step 1: Bank initialized
Step 2: Deposited 1000 tokens
Step 3: Withdrew 500 tokens

Part 7 withdraw test passed!
test test_withdraw_creates_p2id_note ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::tip Troubleshooting
**"Insufficient balance for withdrawal"**: Make sure the deposit was processed before attempting withdrawal.

**"Missing expected output note"**: Verify the P2ID note parameters (tag, serial_num, etc.) match exactly.
:::

## What We've Built So Far

| Component               | Status      | Description                           |
| ----------------------- | ----------- | ------------------------------------- |
| `bank-account`          | ✅ Complete | Full deposit AND withdraw logic       |
| `deposit-note`          | ✅ Complete | Note script for deposits              |
| `withdraw-request-note` | ✅ Complete | Note script for withdrawals           |
| `init-tx-script`        | ✅ Complete | Transaction script for initialization |

## Complete Code for This Part

<details>
<summary>Click to see the complete withdraw-request-note code</summary>

```rust title="contracts/withdraw-request-note/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the bank account's generated bindings
use crate::bindings::miden::bank_account::bank_account;

/// Withdraw Request Note Script
///
/// When consumed by the Bank account, this note requests a withdrawal and
/// the bank creates a P2ID note to send assets back to the depositor.
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset encoded as [amount, 0, faucet_suffix, faucet_prefix]
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed)
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get the storage items
        let storage = active_note::get_storage();

        // Asset: reconstruct from [amount, 0, faucet_suffix, faucet_prefix] encoding
        let withdraw_asset = Asset::new(
            Word::from([felt!(0), felt!(0), storage[2], storage[3]]),
            Word::from([storage[0], felt!(0), felt!(0), felt!(0)]),
        );

        // Serial number: full 4 Felts (random/unique per note)
        let serial_num = Word::from([storage[4], storage[5], storage[6], storage[7]]);

        // Tag: single Felt for P2ID note routing
        let tag = storage[8];

        // Note type: 1 = Public, 2 = Private
        let note_type = storage[9];

        // Note: P2ID script root (storage[10..13]) is read by the bank account
        // directly from the active note's storage inside bank_account::withdraw.

        // Call the bank account to withdraw the assets
        bank_account::withdraw(depositor, withdraw_asset, serial_num, tag, note_type);
    }
}
```

</details>

## Key Takeaways

1. **`note::build_recipient()`** creates a cryptographic commitment from serial number, script root, and storage items
2. **`output_note::create()`** creates the note with tag, note type, and recipient
3. **`output_note::add_asset()`** attaches assets to the created note
4. **P2ID pattern** uses a standard script with account ID as input
5. **Serial numbers** must be unique to prevent note replay
6. **Array ordering** - P2ID expects `[suffix, prefix, ...]` not `[prefix, suffix, ...]`
7. **Always validate before subtraction** to prevent underflow exploits

:::tip View Complete Source
See the complete implementation in the [examples/miden-bank](https://github.com/0xMiden/miden-tutorials/tree/main/examples/miden-bank) directory.
:::

## Next Steps

Now that you've built all the components, let's see how they work together in [Part 8: Complete Flows](./complete-flows).
