---
sidebar_position: 4
title: "Part 4: Note Scripts"
description: "Learn how to write note scripts that execute when notes are consumed, using active_note APIs to access sender, assets, and inputs."
---

# Part 4: Note Scripts

In this section, you'll learn how to write note scripts - code that executes when a note is consumed by an account. We'll create the deposit note that lets users deposit tokens into the bank.

## What You'll Build in This Part

By the end of this section, you will have:

- Created the `deposit-note` contract
- Understood the `#[note]` struct+impl pattern and `#[note_script]` method attribute
- Used `active_note` APIs to access sender and assets
- Built the note script and its dependencies
- **Verified it works** with a complete deposit flow test

## Building on Part 3

In Part 3, we completed the bank's deposit method. Now we need a way to trigger it:

```text
Part 3:                          Part 4:
┌──────────────────┐             ┌──────────────────┐
│ Bank (complete)  │             │ Bank (complete)  │
│ ─────────────────│             │ ─────────────────│
│ + deposit()      │             │ + deposit()      │
│ + withdraw()     │             │ + withdraw()     │
└──────────────────┘             └──────────────────┘
                                          ▲
                                          │ calls
                                 ┌────────────────────┐
                                 │ deposit-note       │ ◄── NEW
                                 │ (note script)      │
                                 └────────────────────┘
```

## Note Scripts vs Account Components

| Feature     | Account Component         | Note Script                                |
| ----------- | ------------------------- | ------------------------------------------ |
| Purpose     | Persistent account logic  | One-time execution when consumed           |
| Storage     | Has persistent storage    | No storage (reads from note data)          |
| Attribute   | `#[component]`            | `#[note]` struct + `#[note_script]` method |
| Entry point | Methods on struct         | `fn run(self, _arg: Word)`                 |
| Invocation  | Called by other contracts | Executes when note is consumed             |

Note scripts are like "messages" that carry code along with data and assets.

## Step 1: Create the Deposit Note Project

First, create the deposit-note contract. If you used `miden new`, you may have an `increment-note` folder - rename or replace it:

```bash title=">_ Terminal"
# Remove or rename the example
rm -rf contracts/increment-note
# Or: mv contracts/increment-note contracts/increment-note-backup

# Create the deposit-note directory
mkdir -p contracts/deposit-note/src
```

## Step 2: Configure Cargo.toml

Create the `Cargo.toml` for the deposit note:

```toml title="contracts/deposit-note/Cargo.toml"
[package]
name = "deposit-note"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { version = "0.12" }

[package.metadata.component]
package = "miden:deposit-note"

[package.metadata.miden]
project-kind = "note-script"

# Dependencies on account components
[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }

[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

Key configuration:

- `project-kind = "note-script"` - Marks this as a note script
- Dependencies sections declare which accounts it can interact with

## Step 3: Implement the Deposit Note

Create the note script implementation:

```rust title="contracts/deposit-note/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the bank account's generated bindings
use crate::bindings::miden::bank_account::bank_account;

/// Deposit Note Script
///
/// When consumed by the Bank account, this note transfers all its assets
/// to the bank and credits the depositor (note sender) with the deposited amount.
#[note]
struct DepositNote;

#[note]
impl DepositNote {
    #[note_script]
    fn run(self, _arg: Word) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get all assets attached to this note
        let assets = active_note::get_assets();

        // Deposit each asset into the bank
        for asset in assets {
            bank_account::deposit(depositor, asset);
        }
    }
}
```

### The #[note] and #[note_script] Attributes

The `#[note]` attribute is applied to both a unit struct and its `impl` block to define a note script. Within the `impl` block, the `#[note_script]` attribute marks the entry point method. The function signature is always:

```rust
fn run(self, _arg: Word)
```

The method takes `self` as its first parameter. The `_arg` parameter can pass additional data, but we don't use it in the deposit note.

## Note Context APIs

The `active_note` module provides APIs to access note data during execution:

### get_sender() - Who Created the Note

```rust
let depositor = active_note::get_sender();
```

Returns the `AccountId` of the account that created/sent the note. In our bank:

- The sender is the depositor
- Their ID is used to credit their balance

### get_assets() - Attached Assets

```rust
let assets = active_note::get_assets();
for asset in assets {
    // Process each asset
}
```

Returns an iterator over all assets attached to the note.

### get_storage() - Note Parameters

```rust
let storage = active_note::get_storage();
let first_item = storage[0];
```

Returns a slice of `Felt` values passed when the note was created. We'll use storage items in the withdraw request note (Part 7).

## Step 4: Update the Workspace

Update the root `Cargo.toml` to include the new contract:

```toml title="Cargo.toml" {5}
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

## Step 5: Build the Note Script

:::info Build Order Matters
Build account components **first** before building note scripts that depend on them. The note script needs the generated WIT files from the account.
:::

```bash title=">_ Terminal"
# First, ensure bank-account is built (generates WIT files)
cd contracts/bank-account
miden build

# Now build the deposit note
cd ../deposit-note
miden build
```

<details>
<summary>Expected output</summary>

```text
   Compiling deposit-note v0.1.0
    Finished `release` profile [optimized] target(s)
Creating Miden package /path/to/miden-bank/target/miden/release/deposit_note.masp
```

</details>

## Execution Flow Diagram

```text
1. User creates deposit note with 100 tokens attached
   ┌───────────────────────────────────────┐
   │ Note: deposit-note                    │
   │ Sender: User's AccountId              │
   │ Assets: [100 tokens]                  │
   └───────────────────────────────────────┘

2. Bank account consumes the note
   ┌───────────────────────────────────────┐
   │ Bank receives assets into vault       │
   │ Note script executes...               │
   └───────────────────────────────────────┘

3. Note script runs
   depositor = get_sender()  → User's AccountId
   assets = get_assets()     → [100 tokens]
   bank_account::deposit(depositor, 100 tokens)

4. Bank's deposit() method executes
   - Validates initialization and amount
   - Updates balance: balances[User] += 100
   - Adds asset to vault
```

## Try It: Verify Deposits Work

Now let's write a test to verify the complete deposit flow. This test:

1. Initializes the bank
2. Creates a deposit note with tokens
3. Has the bank consume the note
4. Verifies the balance was updated

```rust title="integration/tests/part4_deposit_note_test.rs"
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
async fn test_deposit_note_credits_depositor() -> anyhow::Result<()> {
    // =========================================================================
    // SETUP: Build contracts and create mock chain
    // =========================================================================
    let mut builder = MockChain::builder();

    // Create a faucet for test tokens
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, "TEST", 10_000_000, Some(10))?;

    // Create sender (depositor) wallet
    let sender = builder.add_existing_wallet_with_assets(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, [FungibleAsset::new(faucet.id(), 1000)?.into()])?;

    // Build all contracts
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

    // Create bank account
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

    builder.add_account(bank_account.clone())?;

    // Create the deposit note and add it before building the chain
    let deposit_amount: u64 = 1000;
    let fungible_asset = FungibleAsset::new(faucet.id(), deposit_amount)?;
    let note_assets = NoteAssets::new(vec![Asset::Fungible(fungible_asset)])?;

    let deposit_note = create_testing_note_from_package(
        deposit_note_package.clone(),
        sender.id(),  // Sender is the depositor
        NoteCreationConfig {
            assets: note_assets,
            ..Default::default()
        },
    )?;

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

    println!("Step 1: Bank initialized");

    // =========================================================================
    // STEP 2: Execute deposit
    // =========================================================================
    let tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    let executed_transaction = tx_context.execute().await?;
    bank_account.apply_delta(&executed_transaction.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_transaction)?;
    mock_chain.prove_next_block()?;

    println!("Step 2: Deposit note consumed");

    // =========================================================================
    // VERIFY: Balance was updated
    // =========================================================================
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        faucet.id().prefix().as_felt(),
        faucet.id().suffix(),
    ]);

    let balance = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;
    let balance_value = balance[3].as_canonical_u64();

    println!("Step 3: Verified balance = {}", balance_value);

    assert_eq!(
        balance_value,
        deposit_amount,
        "Balance should equal deposited amount"
    );

    println!("\nPart 4 deposit note test passed!");

    Ok(())
}
```

:::note Dependencies
This test requires the `init-tx-script` contract which we'll create in Part 6. You can either:

1. Skip ahead to create a minimal init-tx-script (see Part 6)
2. Run this test after completing Part 6

For now, verify that your deposit-note builds successfully.
:::

Run the test from the project root (after creating init-tx-script in Part 6):

```bash title=">_ Terminal"
cargo test --package integration test_deposit_note_credits_depositor -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part4_deposit_note_test.rs

running 1 test
Step 1: Bank initialized
Step 2: Deposit note consumed
Step 3: Verified balance = 1000

Part 4 deposit note test passed!
test test_deposit_note_credits_depositor ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

## Preview: Withdraw Request Note

For withdrawals, we'll use note inputs to pass parameters. Here's a preview of the withdraw request note (implemented in Part 7):

```rust title="contracts/withdraw-request-note/src/lib.rs (preview)"
/// Withdraw Request Note Script
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
        let depositor = active_note::get_sender();
        let storage = active_note::get_storage();

        // Parse parameters from storage
        let withdraw_asset = Asset::new(
            Word::from([felt!(0), felt!(0), storage[2], storage[3]]),
            Word::from([storage[0], felt!(0), felt!(0), felt!(0)]),
        );

        let serial_num = Word::from([
            storage[4], storage[5], storage[6], storage[7]
        ]);

        let tag = storage[8];
        let note_type = storage[9];

        // Note: P2ID script root (storage[10..13]) is read by the bank account
        // directly from the active note's storage inside bank_account::withdraw.

        bank_account::withdraw(depositor, withdraw_asset, serial_num, tag, note_type);
    }
}
```

:::warning Stack Limits
Note inputs are limited. Keep your input layout compact. See [Common Pitfalls](https://docs.miden.xyz/builder/tutorials/rust-compiler/pitfalls) for stack-related constraints.
:::

## Complete Code for This Part

<details>
<summary>Click to expand deposit-note/src/lib.rs</summary>

```rust title="contracts/deposit-note/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

use crate::bindings::miden::bank_account::bank_account;

/// Deposit Note Script
#[note]
struct DepositNote;

#[note]
impl DepositNote {
    #[note_script]
    fn run(self, _arg: Word) {
        let depositor = active_note::get_sender();
        let assets = active_note::get_assets();

        for asset in assets {
            bank_account::deposit(depositor, asset);
        }
    }
}
```

</details>

## Key Takeaways

1. **`#[note]`** marks the struct and impl block, with **`#[note_script]`** on the entry point method `fn run(self, _arg: Word)`
2. **`active_note::get_sender()`** returns who created the note
3. **`active_note::get_assets()`** returns assets attached to the note
4. **`active_note::get_storage()`** returns parameterized data
5. **Note scripts execute once** when consumed - no persistent state
6. **Build order matters** - account components first, then note scripts

:::tip View Complete Source
See the complete note script implementations:

- [Deposit Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/deposit-note/src/lib.rs)
- [Withdraw Request Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/withdraw-request-note/src/lib.rs)
  :::

## Next Steps

Now that you understand note scripts, let's learn how they call account methods in [Part 5: Cross-Component Calls](./cross-component-calls).
