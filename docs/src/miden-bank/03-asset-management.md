---
sidebar_position: 3
title: "Part 3: Asset Management"
description: "Learn how to handle fungible assets in Miden Rust contracts using vault operations and balance tracking."
---

# Part 3: Asset Management

In this section, you'll learn how to receive and send assets in Miden accounts. We'll complete the deposit logic that receives tokens into the bank's vault and tracks balances per depositor.

## What You'll Build in This Part

By the end of this section, you will have:

- Understood the `Asset` type structure for fungible assets
- Implemented full deposit logic with `native_account::add_asset()`
- Learned about balance key design for per-user, per-asset tracking
- Added a withdraw method skeleton (to be completed in Part 7)
- **Verified deposits work** with a MockChain test

## Building on Part 2

In Part 2, we added constraints. Now we'll complete the deposit function with actual asset handling:

```text
Part 2:                          Part 3:
┌──────────────────┐             ┌──────────────────┐
│ Bank             │             │ Bank             │
│ ─────────────────│    ──►      │ ─────────────────│
│ + deposit()      │             │ + deposit()      │ ◄── COMPLETE
│   (skeleton)     │             │   + balance tracking
│                  │             │   + vault operations
│                  │             │ + withdraw()     │ ◄── NEW (skeleton)
└──────────────────┘             └──────────────────┘
```

## The Asset Type

Miden splits a fungible `Asset` into a `value` word and a `key` word. The `value`
holds the amount; the `key` is the vault key word. In protocol v0.15 the fungible
vault key word has this layout:

```text
Asset value: [amount, 0, 0, 0]
Asset key:   [asset_id_suffix, asset_id_prefix, faucet_suffix | metadata, faucet_prefix]
                                                 ━━━━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━
                                                        key index 2        key index 3
```

| Word    | Index | Field                       | Description                                                      |
| ------- | ----- | --------------------------- | ---------------------------------------------------------------- |
| `value` | 0     | `amount`                    | The quantity of tokens                                           |
| `value` | 1     | (reserved)                  | Always 0 for fungible assets                                     |
| `key`   | 2     | `faucet_suffix \| metadata` | Faucet ID suffix with a metadata byte folded into the low 8 bits |
| `key`   | 3     | `faucet_prefix`             | First part of the faucet account ID                              |

Access the amount through `asset.value` and the faucet ID through `asset.key`:

```rust
let amount = deposit_asset.value[0];           // The token amount
let faucet_suffix = deposit_asset.key[2];      // Faucet ID suffix (+ metadata byte)
let faucet_prefix = deposit_asset.key[3];      // Faucet ID prefix
```

:::note v0.15 vault-key layout
`asset.key[2]` is **not** the raw faucet suffix — the asset's metadata byte
(composition + a callback flag) is folded into its low 8 bits. For the
callbacks-disabled fungible assets this bank accepts that byte is constant, so
`(asset.key[3], asset.key[2])` is still a stable per-faucet identifier. The
host-side mirror is `FungibleAsset::to_key_word()` indices `[3]` / `[2]`.
:::

## Receiving Assets with add_asset()

The `native_account::add_asset()` function adds an asset to the account's vault:

```rust
// Add asset to the bank's vault
native_account::add_asset(deposit_asset);
```

When called:

- The asset is added to the account's internal vault
- The vault tracks all assets the account holds
- Multiple assets of the same type are combined automatically

:::info Vault vs Balance Tracking
The vault is managed by the Miden protocol automatically. Our `StorageMap` for balances is an **application-level** tracking of who deposited what, separate from the protocol-level vault.
:::

## Step 1: Complete the Deposit Function

Update `contracts/bank-account/src/lib.rs` to complete the deposit function with balance tracking and vault operations:

```rust title="contracts/bank-account/src/lib.rs"
fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
    // NOTE: Initialization guard — enabled in Part 6 (Transaction Scripts)
    // self.require_initialized();

    // Verify this is a fungible asset.
    // For fungible assets, value = [amount, 0, 0, 0]; value[1] is always 0.
    assert!(
        deposit_asset.value[1].as_canonical_u64() == 0,
        "Only fungible assets are supported"
    );

    // Extract the fungible amount from the asset value word
    let deposit_amount = deposit_asset.value[0];

    // Validate deposit amount does not exceed maximum
    assert!(
        deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
        "Deposit amount exceeds maximum allowed"
    );

    // Derive the balance-map key from the depositor and the asset's faucet.
    let key = Word::from([
        depositor.prefix,
        depositor.suffix,
        deposit_asset.key[3], // faucet_prefix
        deposit_asset.key[2], // faucet_suffix (+ metadata byte; see `balances` field docs)
    ]);

    // Update balance in integer space to avoid modular Felt wraparound.
    // Felt arithmetic is modular (wraps at the Goldilocks prime), so we
    // validate entirely in u64 before storing the result as a Felt.
    let current_balance: Felt = self.balances.get(key);
    let current_u64 = current_balance.as_canonical_u64();
    let deposit_u64 = deposit_amount.as_canonical_u64();

    let new_balance_u64 = current_u64
        .checked_add(deposit_u64)
        .expect("Balance overflow: addition exceeds u64 range");
    assert!(
        new_balance_u64 <= MAX_BALANCE,
        "Balance would exceed maximum allowed"
    );

    // Guest-side `Felt::new` is fallible, so unwrap the validated value.
    self.balances.set(key, Felt::new(new_balance_u64).unwrap());

    // Add asset to the bank's vault
    native_account::add_asset(deposit_asset);
}
```

### Balance Key Design

The key is derived inline at each call site (in `deposit`, `withdraw`, and
`get_depositor_balance`) by packing the depositor and the asset's faucet into a
composite `Word`:

```rust
let key = Word::from([
    depositor.prefix,      // Who deposited
    depositor.suffix,
    deposit_asset.key[3],  // Which asset type (faucet ID prefix)
    deposit_asset.key[2],  // Which asset type (faucet ID suffix + metadata byte)
]);
```

This design allows:

- **Per-depositor tracking**: Each user has their own balance
- **Per-asset tracking**: Different token types are tracked separately
- **Unique keys**: The combination ensures no collisions

Because `asset.key[2]` carries the v0.15 metadata byte in its low bits (not the raw
faucet suffix), the host side must derive the _same_ key from
`FungibleAsset::to_key_word()` rather than from `faucet.id().suffix()` directly — the
test below shows this.

The remaining internal helpers live in a separate, plain `impl BankStorage` block (not
the `#[component]` trait impl), because the `#[component]` macro exports only the trait
methods as the contract's WIT API; inherent methods like `require_initialized` and
`create_p2id_note` stay private to the contract.

## Step 2: Add the Withdraw Method Skeleton

Now add a withdraw method skeleton. We'll complete it in Part 7 when we cover output notes.

:::danger Critical Security Warning: Felt Arithmetic Underflow

Miden uses **modular field arithmetic**. Subtracting a larger value from a smaller one does **NOT** cause an error - it **silently wraps** to a massive positive number!

For example: `50 - 100` does NOT equal `-50`. Instead, it equals a number close to `2^64`.

**You MUST validate before ANY subtraction:**

```rust
// WRONG - DANGEROUS! Silent underflow if balance < amount
let new_balance = current_balance - withdraw_amount;

// CORRECT - Always validate first
assert!(
    current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
    "Withdrawal amount exceeds available balance"
);
let new_balance = current_balance - withdraw_amount;
```

This is not optional - it's a **security requirement** for any financial operation.
:::

Add this method to your Bank impl block:

```rust title="contracts/bank-account/src/lib.rs"
fn withdraw(
    &mut self,
    withdraw_asset: Asset,
    serial_num: Word,
    tag: Felt,
    note_type: Felt,
) {
    // NOTE: Initialization guard — enabled in Part 6 (Transaction Scripts)
    // self.require_initialized();

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

    // ========================================================================
    // CRITICAL: Validate balance BEFORE subtraction
    // ========================================================================
    // Get current balance and validate sufficient funds exist.
    // This check is critical: Felt arithmetic is modular, so subtracting
    // more than the balance would silently wrap to a large positive number.
    let current_balance: Felt = self.balances.get(key);
    assert!(
        current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
        "Withdrawal amount exceeds available balance"
    );

    // Now safe to subtract
    let new_balance = current_balance - withdraw_amount;
    self.balances.set(key, new_balance);

    // Create a P2ID note to send the requested asset back to the depositor.
    // The full implementation (reading the P2ID script root from the note's
    // storage and emitting the output note) lands in Part 7.
    self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type);
}
```

For now, add a placeholder for `create_p2id_note()` in the private
`impl BankStorage` block:

```rust title="contracts/bank-account/src/lib.rs"
/// Create a P2ID note to send assets to a recipient.
/// Full implementation in Part 7.
fn create_p2id_note(
    &mut self,
    _serial_num: Word,
    _asset: &Asset,
    _recipient_id: AccountId,
    _tag: Felt,
    _note_type: Felt,
) {
    // Placeholder - implemented in Part 7: Output Notes
    // For now, this will cause a compile error if actually called
    todo!("P2ID note creation - see Part 7")
}
```

## Step 3: Build and Verify

Build the contract:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

:::note Cosmetic build output
The part2 compiler prints non-fatal `MAST`-serialization `ERROR` lines on every
build. They are cosmetic — the build still succeeds and produces the `.masp`.
:::

## Try It: Verify Deposits Work

First, verify your bank-account contract compiles:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

:::note Test Dependencies
The full deposit test below also drives the `deposit-note` contract (Part 4) and the
`init-tx-script` (Part 6). You can return to run it after completing those parts.
:::

<details>
<summary>Preview: Full deposit test (runnable after Parts 4 and 6)</summary>

This test verifies the complete deposit flow — it initializes the bank via the tx
script, then consumes the deposit note and checks the recorded balance:

```rust title="integration/tests/deposit_test.rs"
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
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration --test deposit_test -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/deposit_test.rs

running 3 tests
Bank initialized successfully
Deposit test passed! Deposited 1000 tokens
test deposit_test ... ok
test deposit_exceeds_max_should_fail ... ok
test deposit_without_init_should_fail ... ok

test result: ok. 3 passed; 0 failed; 0 ignored
```

:::note Cosmetic build output
Each contract build during the test prints non-fatal `MAST`-serialization `ERROR`
lines from the part2 compiler. They are cosmetic and do not affect the result.
:::

</details>

</details>

## Asset Flow Summary

```text
DEPOSIT FLOW:
┌───────────┐   deposit_note    ┌────────────┐
│ Depositor │ ──────────────────▶ Bank Vault │
│  Wallet   │    (with asset)   │  + Balance │
└───────────┘                   └────────────┘

WITHDRAW FLOW:
┌────────────┐   P2ID note      ┌───────────┐
│ Bank Vault │ ──────────────────▶ Depositor│
│  - Balance │   (with asset)   │  Wallet   │
└────────────┘                  └───────────┘
```

## Complete Code for This Part

Here's the full `lib.rs` after Part 3:

<details>
<summary>Click to expand full code</summary>

```rust title="contracts/bank-account/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

use miden::Felt;

/// Maximum allowed deposit amount per transaction.
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Maximum allowed balance per depositor per asset.
/// Matches FungibleAsset::MAX_AMOUNT (2^63 - 2^31).
const MAX_BALANCE: u64 = 9_223_372_034_707_292_160;

/// Storage layout for the bank account component.
#[component_storage]
struct BankStorage {
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps (depositor AccountId, faucet ID) -> balance (as Felt).
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

/// API of the bank account component.
#[component]
trait Bank {
    /// Initialize the bank account, enabling deposits.
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    ///
    /// Named `get_depositor_balance` (not `get_balance`) to avoid colliding with
    /// the built-in `ActiveAccount::get_balance` vault method that the account
    /// wrapper generates.
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;

    /// Deposit an asset into the bank for a specific depositor.
    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset);

    /// Withdraw assets back to the depositor.
    fn withdraw(&mut self, withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);
}

#[component]
impl Bank for BankStorage {
    fn initialize(&mut self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt {
        // Create key from depositor's AccountId and asset faucet ID
        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3], // faucet_prefix
            asset.key[2], // faucet_suffix (+ metadata byte; see `balances` field docs)
        ]);
        self.balances.get(key)
    }

    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        // NOTE: Initialization guard — enabled in Part 6 (Transaction Scripts)
        // self.require_initialized();

        assert!(
            deposit_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        let deposit_amount = deposit_asset.value[0];

        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            deposit_asset.key[3], // faucet_prefix
            deposit_asset.key[2], // faucet_suffix (+ metadata byte; see `balances` field docs)
        ]);

        // Validate in integer space — Felt addition is modular
        let current_balance: Felt = self.balances.get(key);
        let current_u64 = current_balance.as_canonical_u64();
        let deposit_u64 = deposit_amount.as_canonical_u64();
        let new_balance_u64 = current_u64
            .checked_add(deposit_u64)
            .expect("Balance overflow");
        assert!(new_balance_u64 <= MAX_BALANCE, "Balance would exceed maximum");

        // Guest-side `Felt::new` is fallible, so unwrap the validated value.
        self.balances.set(key, Felt::new(new_balance_u64).unwrap());

        native_account::add_asset(deposit_asset);
    }

    /// Withdraw assets from the bank.
    /// The depositor is identified via `active_note::get_sender()` internally.
    fn withdraw(
        &mut self,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        // NOTE: Initialization guard — enabled in Part 6 (Transaction Scripts)
        // self.require_initialized();

        let depositor = active_note::get_sender();

        assert!(
            withdraw_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        let withdraw_amount = withdraw_asset.value[0];

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            withdraw_asset.key[3], // faucet_prefix
            withdraw_asset.key[2], // faucet_suffix (+ metadata byte; see `balances` field docs)
        ]);

        // CRITICAL: Validate balance BEFORE subtraction
        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        // Full P2ID note creation lands in Part 7.
        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type);
    }
}

/// Internal helpers that are not part of the component's exported WIT API.
///
/// The `#[component]` macro exports only the methods of the `Bank` trait, so these
/// inherent methods stay private to the contract.
impl BankStorage {
    /// Check that the bank is initialized.
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }

    /// Create a P2ID note - placeholder for Part 7.
    fn create_p2id_note(
        &mut self,
        _serial_num: Word,
        _asset: &Asset,
        _recipient_id: AccountId,
        _tag: Felt,
        _note_type: Felt,
    ) {
        todo!("P2ID note creation - see Part 7")
    }
}
```

</details>

## Key Takeaways

1. **Asset layout**: `value[0]` = amount; `key[2]` = faucet_suffix + metadata byte (v0.15); `key[3]` = faucet_prefix. Mirror it host-side with `FungibleAsset::to_key_word()` indices `[3]`/`[2]`
2. **`native_account::add_asset()`** adds assets to the vault
3. **`native_account::remove_asset()`** removes assets from the vault (Part 7)
4. **Balance tracking** is application-level logic using `StorageMap`
5. **Composite keys** allow per-user, per-asset balance tracking
6. **CRITICAL: Always validate before subtraction** - Felt arithmetic wraps silently!

:::tip View Complete Source
See the complete deposit and withdraw implementations in [contracts/bank-account/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/bank-account/src/lib.rs).
:::

## Next Steps

Now that you understand asset management, let's learn how to trigger these operations with [Part 4: Note Scripts](./note-scripts).
