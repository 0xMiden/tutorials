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

Miden represents fungible assets as a `Word` (4 Felts) with this layout:

```text
Asset Layout: [amount, 0, faucet_suffix, faucet_prefix]
              ━━━━━━━  ━  ━━━━━━━━━━━━━  ━━━━━━━━━━━━━
              index 0  1      index 2        index 3
```

| Index | Field           | Description                          |
| ----- | --------------- | ------------------------------------ |
| 0     | `amount`        | The quantity of tokens               |
| 1     | (reserved)      | Always 0 for fungible assets         |
| 2     | `faucet_suffix` | Second part of the faucet account ID |
| 3     | `faucet_prefix` | First part of the faucet account ID  |

Access amount through `asset.value` and faucet ID through `asset.key`:

```rust
let amount = deposit_asset.value[0];           // The token amount
let faucet_suffix = deposit_asset.key[2];      // Faucet ID suffix
let faucet_prefix = deposit_asset.key[3];      // Faucet ID prefix
```

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
/// Deposit assets into the bank.
pub fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
    // ========================================================================
    // CONSTRAINT: Bank must be initialized
    // ========================================================================
    self.require_initialized();

    // Extract the fungible amount from the asset value word
    let deposit_amount = deposit_asset.value[0];

    // ========================================================================
    // CONSTRAINT: Maximum deposit amount check
    // ========================================================================
    assert!(
        deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
        "Deposit amount exceeds maximum allowed"
    );

    // ========================================================================
    // UPDATE BALANCE
    // ========================================================================
    // Create key from depositor's AccountId and asset faucet ID
    // This allows tracking balances per depositor per asset type
    let key = Word::from([
        depositor.prefix,
        depositor.suffix,
        deposit_asset.key[3], // faucet_prefix
        deposit_asset.key[2], // faucet_suffix
    ]);

    // Update balance: current + deposit_amount
    let current_balance: Felt = self.balances.get(key);
    let new_balance = current_balance + deposit_amount;
    self.balances.set(key, new_balance);

    // ========================================================================
    // ADD ASSET TO VAULT
    // ========================================================================
    native_account::add_asset(deposit_asset);
}
```

### Balance Key Design

We construct a composite key for balance tracking:

```rust
let key = Word::from([
    depositor.prefix,     // Who deposited
    depositor.suffix,
    deposit_asset.key[3], // Which asset type (faucet ID prefix)
    deposit_asset.key[2], // Which asset type (faucet ID suffix)
]);
```

This design allows:

- **Per-depositor tracking**: Each user has their own balance
- **Per-asset tracking**: Different token types are tracked separately
- **Unique keys**: The combination ensures no collisions

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
/// Withdraw assets from the bank.
/// Creates a P2ID note to send assets back to the depositor.
pub fn withdraw(
    &mut self,
    depositor: AccountId,
    withdraw_asset: Asset,
    serial_num: Word,
    tag: Felt,
    note_type: Felt,
) {
    // ========================================================================
    // CONSTRAINT: Bank must be initialized
    // ========================================================================
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

    // Create a P2ID note to send the requested asset back to the depositor
    // We'll implement create_p2id_note() in Part 7
    self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type);
}
```

For now, add a placeholder for `create_p2id_note()`:

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

## Try It: Verify Deposits Work

Let's write a test to verify our deposit logic works correctly:

```rust title="integration/tests/part3_deposit_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package,
    create_testing_note_from_package, AccountCreationConfig, NoteCreationConfig,
};
use miden_client::account::{StorageMap, StorageSlot, StorageSlotName};
use miden_client::asset::{Asset, FungibleAsset};
use miden_client::auth::AuthSchemeId;
use miden_client::note::NoteAssets;
use miden_client::transaction::{RawOutputNote, TransactionScript};
use miden_client::{Felt, Word};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

#[tokio::test]
async fn test_deposit_updates_balance() -> anyhow::Result<()> {
    // =========================================================================
    // SETUP
    // =========================================================================
    let mut builder = MockChain::builder();

    // Create a faucet for test tokens
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, "TEST", 10_000_000, Some(10))?;

    // Create sender wallet with tokens
    let sender = builder.add_existing_wallet_with_assets(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, [FungibleAsset::new(faucet.id(), 1000)?.into()])?;

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

    // Create the bank account with storage slots
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

    // Add to mock chain
    builder.add_account(bank_account.clone())?;

    // =========================================================================
    // STEP 2: Create deposit note before building the mock chain
    // =========================================================================
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

    // Add note to builder before building
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));

    let mut mock_chain = builder.build()?;

    // =========================================================================
    // STEP 1: Initialize the bank
    // =========================================================================
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

    // Verify initialization
    let initialized = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        initialized[0].as_canonical_u64(),
        1,
        "Bank should be initialized"
    );
    println!("Bank initialized successfully!");

    // =========================================================================
    // STEP 2: Execute deposit
    // =========================================================================

    // Execute deposit transaction
    let tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    let executed_transaction = tx_context.execute().await?;
    bank_account.apply_delta(&executed_transaction.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_transaction)?;
    mock_chain.prove_next_block()?;

    println!("Deposit transaction executed!");

    // =========================================================================
    // VERIFY: Check balance was updated
    // =========================================================================
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        faucet.id().prefix().as_felt(),
        faucet.id().suffix(),
    ]);

    let balance = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;

    // Balance is stored as a single Felt in the last position of the Word
    let balance_value = balance[3].as_canonical_u64();

    println!("Depositor balance: {}", balance_value);
    assert_eq!(
        balance_value,
        deposit_amount,
        "Balance should equal deposited amount"
    );

    println!("\nPart 3 deposit test passed!");

    Ok(())
}
```

:::note Test Dependencies
This test requires:

- `deposit-note` contract (Part 4)
- `init-tx-script` contract (Part 6)

If you haven't created these yet, you can run this test after completing Parts 4 and 6, or create placeholder contracts. For now, let's verify the bank-account compiles correctly.
:::

Build verification:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

If you have the note scripts ready, run the full test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_deposit_updates_balance -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part3_deposit_test.rs

running 1 test
Bank initialized successfully!
Deposit transaction executed!
Depositor balance: 1000

Part 3 deposit test passed!
test test_deposit_updates_balance ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

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

/// Maximum allowed deposit amount per transaction.
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Bank account component that tracks depositor balances.
#[component]
struct Bank {
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

#[component]
impl Bank {
    /// Initialize the bank account, enabling deposits.
    pub fn initialize(&mut self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    /// Get the balance for a depositor.
    pub fn get_balance(&self, depositor: AccountId) -> Felt {
        let key = Word::from([depositor.prefix, depositor.suffix, felt!(0), felt!(0)]);
        self.balances.get(key)
    }

    /// Check that the bank is initialized.
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }

    /// Deposit assets into the bank.
    pub fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        self.require_initialized();

        let deposit_amount = deposit_asset.value[0];

        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            deposit_asset.key[3], // faucet_prefix
            deposit_asset.key[2], // faucet_suffix
        ]);

        let current_balance: Felt = self.balances.get(key);
        let new_balance = current_balance + deposit_amount;
        self.balances.set(key, new_balance);

        native_account::add_asset(deposit_asset);
    }

    /// Withdraw assets from the bank.
    pub fn withdraw(
        &mut self,
        depositor: AccountId,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        self.require_initialized();

        let withdraw_amount = withdraw_asset.value[0];

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            withdraw_asset.key[3], // faucet_prefix
            withdraw_asset.key[2], // faucet_suffix
        ]);

        // CRITICAL: Validate balance BEFORE subtraction
        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type);
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

1. **Asset layout**: `value[0]` = amount; `key[2]` = faucet_suffix; `key[3]` = faucet_prefix
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
