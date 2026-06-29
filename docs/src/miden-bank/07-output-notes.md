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

## Step 1: Complete the Withdraw Method

In Part 3, we introduced `withdraw()` and `create_p2id_note()` as skeletons. Now we'll complete them with full implementations.

Update `contracts/bank-account/src/lib.rs`:

```rust title="contracts/bank-account/src/lib.rs"
#[component]
impl Bank for BankStorage {
    // ... existing methods (initialize, deposit, get_depositor_balance) ...

    fn withdraw(
        &mut self,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        // Ensure the bank is initialized before processing withdrawals
        self.require_initialized();

        // Identify the depositor from the note's sender — this is cryptographically
        // bound to the note metadata, so it cannot be spoofed by a malicious caller.
        let depositor = active_note::get_sender();

        // Verify this is a fungible asset — see `deposit()` for the rationale.
        assert!(
            withdraw_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        // Extract the fungible amount from the asset value word
        let withdraw_amount = withdraw_asset.value[0];

        // Derive the balance-map key from the depositor and the asset's faucet.
        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            withdraw_asset.key[3], // faucet_prefix
            withdraw_asset.key[2], // faucet_suffix (+ metadata byte; see `balances` field docs)
        ]);

        // Get current balance and validate sufficient funds exist.
        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        // Update balance: current - withdraw_amount
        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        // Read the P2ID script root from the withdraw-request note's storage (items 10-13).
        let storage = active_note::get_storage();
        let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);

        // Create a P2ID note to send the requested asset back to the depositor
        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type, script_root);
    }
}
```

The withdraw method derives the balance-map key inline by packing `depositor.prefix`, `depositor.suffix`, `withdraw_asset.key[3]`, and `withdraw_asset.key[2]` into a `Word`. In the v0.15 fungible-asset vault-key layout, `asset.key[3]` is the faucet id prefix and `asset.key[2]` is the faucet id suffix with the asset's metadata byte folded into its low 8 bits — so `key[2]` is NOT the raw faucet suffix. `withdraw()` and `deposit()` derive the key the same way so a withdrawal reconstructs the exact key the deposit was recorded under.

:::danger Critical Security: Balance Validation
Always validate `current_balance >= withdraw_amount` BEFORE subtraction. Miden uses modular field arithmetic - subtracting a larger value silently wraps to a massive positive number!
:::

## Step 2: How the P2ID Script Root is Supplied

Instead of hardcoding a version-specific MAST root constant in the bank contract, the P2ID script root is passed through the withdraw-request note's storage (items 10-13). The `withdraw()` method reads it directly from the active note:

```rust
let storage = active_note::get_storage();
let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);
```

This design keeps the bank contract version-agnostic: callers embed the P2ID script root they want to use into the note storage when they create the withdraw-request note. The test obtains the correct value at test time with `P2idNote::script_root()` from the `miden_client` crate. In v0.15 `script_root()` returns a `NoteScriptRoot`, so wrap it in `Word::from(...)` before indexing its felts (see the test below).

## Step 3: Implement create_p2id_note

This replaces the `todo!()` placeholder from Part 3. The `#[component]` macro exports only the `Bank` trait methods, so `create_p2id_note` (along with the other private helper `require_initialized`) lives in a plain `impl BankStorage` block, NOT inside `impl Bank for BankStorage`. Add the full implementation:

```rust title="contracts/bank-account/src/lib.rs"
/// Internal helpers that are not part of the component's exported WIT API.
///
/// The `#[component]` macro exports only the methods of the `Bank` trait, so these
/// inherent methods stay private to the contract.
impl BankStorage {
    // ... other helpers (require_initialized) ...

    /// Create a P2ID (Pay-to-ID) note to send assets to a recipient.
    ///
    /// The P2ID script root is read from the active note's storage by the caller.
    fn create_p2id_note(
        &mut self,
        serial_num: Word,
        asset: &Asset,
        recipient_id: AccountId,
        tag: Felt,
        note_type: Felt,
        script_root: Word,
    ) {
        // Convert the passed tag Felt to a Tag and note_type Felt to a NoteType.
        // note_type: 1 = Public (stored on-chain), 2 = Private (off-chain)
        let tag = Tag::from(tag);
        let note_type = NoteType::from(note_type);

        // Compute the recipient hash from serial_num, the P2ID script root, and the
        // target account ID [suffix, prefix]. This matches the standard P2ID recipient
        // format used by miden-standards.
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
        native_account::remove_asset(*asset);

        // Add the asset to the output note
        output_note::add_asset(*asset, note_idx);
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

### Configure the project files

Like the other contracts in this tutorial, the withdraw-request-note has three project files: `Cargo.toml`, `miden-project.toml`, and `.cargo/config.toml`.

```toml title="contracts/withdraw-request-note/Cargo.toml"
[package]
name = "withdraw-request-note"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { git = "https://github.com/0xMiden/compiler", rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b" }
```

```toml title="contracts/withdraw-request-note/miden-project.toml"
[package]
name = "withdraw-request-note"
version = "0.1.0"

[lib]
kind = "note"
namespace = "miden:withdraw-request-note/miden-withdraw-request-note@0.1.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

# WIT for the account component this note calls, produced by building bank-account.
[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
```

```toml title="contracts/withdraw-request-note/.cargo/config.toml"
[build]
target = "wasm32-wasip2"

[target.wasm32-wasip2]
rustflags = ["--cfg", "miden"]
```

The note declares `bank-account` as both a path dependency (so its types are visible) and as a `[package.metadata.miden.dependencies]` WIT dependency pointing at bank-account's generated WIT. That WIT is produced by building bank-account first — see the build order below.

## Step 5: Implement the Withdraw Request Note Script

```rust title="contracts/withdraw-request-note/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Withdraw Request Note Script
///
/// When consumed by the Bank account, this note requests a withdrawal and
/// the bank creates a P2ID note to send assets back to the depositor.
///
/// # Flow
/// 1. Note is created by a depositor specifying the withdrawal details
/// 2. Bank account consumes this note
/// 3. Note script reads the storage items (asset, serial_num, tag, note_type; script_root is read by the bank itself)
/// 4. Calls `account.withdraw(asset, serial_num, tag, note_type)`
/// 5. Bank identifies the depositor internally via `active_note::get_sender()` — cryptographically bound to this note's metadata, so it cannot be spoofed
/// 6. Bank updates the depositor's balance and creates a P2ID note to send assets back
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset, encoded as [amount, 0, faucet_suffix(+metadata), faucet_prefix].
///        Reconstructed into the v0.15 vault key [0, 0, storage[2], storage[3]] and value
///        [amount, 0, 0, 0]. `storage[2]` carries the faucet suffix with the asset's metadata
///        byte in its low 8 bits (host side: `FungibleAsset::to_key_word()[2]`), not the raw
///        suffix — so the bank reconstructs exactly the key the depositor's asset had.
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed).
///          Consumed by the bank account directly from the active note's storage inside
///          `Bank::withdraw`, so it never appears on the call — this keeps that
///          function within the flat-params limit (≤ 16).
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word, account: &mut Wallet) {
        // Get the storage items and validate the expected count.
        let storage = active_note::get_storage();
        assert!(
            storage.len() == 14,
            "Withdraw request requires exactly 14 storage items"
        );

        // Asset: reconstruct the v0.15 fungible-asset key/value from the note storage.
        // key   = [0, 0, storage[2], storage[3]] where storage[2] = faucet suffix + metadata
        //         byte (low 8 bits) and storage[3] = faucet prefix.
        // value = [amount, 0, 0, 0]
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

        // Note: P2ID script root (storage[10..13]) is read by the bank account directly
        // from the active note's storage inside `Bank::withdraw`.

        // Call the bank account to withdraw the assets.
        // The bank identifies the depositor internally via `active_note::get_sender()`,
        // which is cryptographically bound to this note's metadata and cannot be spoofed.
        account.withdraw(withdraw_asset, serial_num, tag, note_type);
    }
}
```

The `#[account(bank_account::Bank)]` macro generates the `Wallet` wrapper from bank-account's WIT, giving the note script a typed `account.withdraw(...)` call. The macro reads bank-account's procedure roots from its compiled `.masp` at compile time, which is why bank-account must be built first.

### Note Storage Layout

The withdraw-request-note uses 14 Felt storage items:

```text
Note Storage (14 Felts):
┌───────────────────────────────────────────────────────────────────────────┐
│ Index │ Value           │ Description                                     │
├───────┼─────────────────┼─────────────────────────────────────────────────┤
│ 0     │ amount          │ Token amount to withdraw                        │
│ 1     │ 0               │ Reserved (always 0 for fungible)                │
│ 2     │ faucet_suffix*  │ Faucet ID suffix + metadata byte (v0.15 key[2]) │
│ 3     │ faucet_prefix   │ Faucet ID prefix (identifies asset type)        │
│ 4-7   │ serial_num      │ Unique ID for the output P2ID note (4 Felts)    │
│ 8     │ tag             │ Note routing tag for P2ID note                  │
│ 9     │ note_type       │ 1 (Public) or 2 (Private)                       │
│ 10-13 │ script_root     │ P2ID script MAST root (Poseidon2-hashed, 4 Felts)│
└───────────────────────────────────────────────────────────────────────────┘
```

\*Index 2 is the v0.15 fungible-asset vault key's `key[2]`: the faucet ID suffix with the asset's metadata byte folded into its low 8 bits, not the raw suffix. The host side encodes it from `FungibleAsset::new(faucet.id(), amount)?.to_key_word()[2]`.

:::note Why the Asset is in Inputs
Unlike the deposit note which gets assets from `active_note::get_assets()`, the withdraw request note doesn't carry assets. Instead, the asset to withdraw is specified in the note inputs. The bank then withdraws from its own vault based on these inputs.
:::

## Step 6: Build All Components

Build in dependency order — bank-account first so its WIT and compiled `.masp` exist before the note that depends on them:

```bash title=">_ Terminal"
# 1. Build the account component (generates WIT files and the .masp)
cd contracts/bank-account
cargo miden build --release

# 2. Build the withdraw request note
cd ../withdraw-request-note
cargo miden build --release
```

:::note Cosmetic build errors
The part2 compiler prints non-fatal `MAST`-serialization `ERROR` lines on every build. They are cosmetic — the build still succeeds and produces the package. You can ignore them.
:::

## Try It: Verify Withdrawals Work

Let's test the complete withdraw flow. This test:

1. Creates a bank account and initializes it
2. Creates a deposit note and processes it
3. Creates a withdraw-request note with the 14-Felt storage layout
4. Processes the withdrawal and verifies a P2ID output note is created

A few v0.15 host-side details to note:

- The bank account's slot names are `bank_account::bank::initialized` and `bank_account::bank::balances`.
- The `initialized` value slot has no schema default, so it MUST be seeded via `InitStorageData` (with a zero `Word` = uninitialized) or `from_package` fails with `InitValueNotProvided`. Only the `balances` map defaults to empty.
- The init transaction script is extracted with the `build_tx_script_from_package` helper. A tx-script package is a `TargetType::TransactionScript`, so `unwrap_program()` / `TransactionScript::from_package` would panic.
- Host-side felts use `Felt::new_unchecked`, and the expected output note uses `PartialNoteMetadata` (not `NoteMetadata`).
- The withdraw asset is encoded from `FungibleAsset::new(faucet.id(), withdraw_amount)?.to_key_word()` indices `[2]`/`[3]` so the bank reconstructs the exact vault key the deposit recorded — NOT from `faucet.id().suffix()/prefix()`.

```rust title="integration/tests/withdraw_test.rs"
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
    // [0-3]: withdraw asset encoded as [amount, 0, faucet_suffix, faucet_prefix]
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
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration --test withdraw_test -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/withdraw_test.rs

running 1 test
test withdraw_test ... ok

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

/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Withdraw Request Note Script
///
/// When consumed by the Bank account, this note requests a withdrawal and
/// the bank creates a P2ID note to send assets back to the depositor.
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset, encoded as [amount, 0, faucet_suffix(+metadata), faucet_prefix].
///        Reconstructed into the v0.15 vault key [0, 0, storage[2], storage[3]] and value
///        [amount, 0, 0, 0]. `storage[2]` carries the faucet suffix with the asset's metadata
///        byte in its low 8 bits (host side: `FungibleAsset::to_key_word()[2]`), not the raw
///        suffix — so the bank reconstructs exactly the key the depositor's asset had.
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed).
///          Consumed by the bank account directly from the active note's storage inside
///          `Bank::withdraw`, so it never appears on the call — this keeps that
///          function within the flat-params limit (≤ 16).
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word, account: &mut Wallet) {
        // Get the storage items and validate the expected count.
        let storage = active_note::get_storage();
        assert!(
            storage.len() == 14,
            "Withdraw request requires exactly 14 storage items"
        );

        // Asset: reconstruct the v0.15 fungible-asset key/value from the note storage.
        // key   = [0, 0, storage[2], storage[3]] where storage[2] = faucet suffix + metadata
        //         byte (low 8 bits) and storage[3] = faucet prefix.
        // value = [amount, 0, 0, 0]
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

        // Note: P2ID script root (storage[10..13]) is read by the bank account directly
        // from the active note's storage inside `Bank::withdraw`.

        // Call the bank account to withdraw the assets.
        // The bank identifies the depositor internally via `active_note::get_sender()`,
        // which is cryptographically bound to this note's metadata and cannot be spoofed.
        account.withdraw(withdraw_asset, serial_num, tag, note_type);
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
