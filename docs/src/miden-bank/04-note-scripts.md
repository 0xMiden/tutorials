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
- Understood the `#[note]` struct+impl pattern and the `#[note_script]` method attribute
- Used the `#[account(...)]` wallet wrapper to call the bank's methods from a note
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

| Feature     | Account Component         | Note Script                                      |
| ----------- | ------------------------- | ------------------------------------------------ |
| Purpose     | Persistent account logic  | One-time execution when consumed                 |
| Storage     | Has persistent storage    | No storage (reads from note data)                |
| Attribute   | `#[component]`            | `#[note]` struct + `#[note_script]` method       |
| Entry point | Methods on struct         | `fn run(self, _arg: Word, account: &mut Wallet)` |
| Invocation  | Called by other contracts | Executes when note is consumed                   |

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

## Step 2: Configure the Project Files

Like every contract in this tutorial, the deposit note has three small config files: a `Cargo.toml`, a `miden-project.toml`, and a `.cargo/config.toml`.

Create the `Cargo.toml`:

```toml title="contracts/deposit-note/Cargo.toml"
[package]
name = "deposit-note"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = "=0.14.0"
```

Create the `miden-project.toml`. This is where the note declares its kind and its dependency on the bank account it calls into:

```toml title="contracts/deposit-note/miden-project.toml"
[package]
name = "deposit-note"
version = "0.1.0"

[lib]
kind = "note"
path = "src/lib.rs"
namespace = "miden:deposit-note/miden-deposit-note@0.1.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

```

Finally, the `.cargo/config.toml` pins the WebAssembly target and the `miden` cfg:

```toml title="contracts/deposit-note/.cargo/config.toml"
[build]
target = "wasm32-wasip2"

[target.wasm32-wasip2]
rustflags = ["--cfg", "miden"]
```

Key configuration:

- `kind = "note"` - Marks this as a note script
- `bank-account = { path = "../bank-account" }` declares the component this note calls. Compiler 0.10 builds the dependency and reads its interface from the compiled package

## Step 3: Implement the Deposit Note

Create the note script implementation:

```rust title="contracts/deposit-note/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Deposit Note Script
///
/// When consumed by the Bank account, this note transfers all its assets
/// to the bank and credits the depositor (note sender) with the deposited amount.
#[note]
struct DepositNote;

#[note]
impl DepositNote {
    #[note_script]
    fn run(self, _arg: Word, account: &mut Wallet) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get all assets attached to this note
        let assets = active_note::get_initial_assets();

        // Deposit each asset into the bank
        for asset in assets {
            account.deposit(depositor, asset);
        }
    }
}
```

:::info Cross-Component Calls
The `#[account(bank_account::Bank)] pub struct Wallet;` declaration and the `account.deposit(...)` call use Miden's cross-component binding system. The `#[account(...)]` macro wraps the consuming account so the note can call the bank's `Bank` methods directly. We'll explain exactly how this works in [Part 5: Cross-Component Calls](./cross-component-calls). When you build `deposit-note`, Compiler 0.10 builds the `bank-account` dependency declared in `miden-project.toml` and reads its interface from the compiled package.
:::

### The #[note] and #[note_script] Attributes

The `#[note]` attribute is applied to both a unit struct and its `impl` block to define a note script. Within the `impl` block, the `#[note_script]` attribute marks the entry point method. The function signature is always:

```rust
fn run(self, _arg: Word, account: &mut Wallet)
```

The method takes `self` as its first parameter. The `_arg` parameter can pass additional data (we don't use it in the deposit note), and `account: &mut Wallet` is the consuming account, through which we call the bank's methods.

## Note Context APIs

The `active_note` module provides APIs to access note data during execution:

### get_sender() - Who Created the Note

```rust
let depositor = active_note::get_sender();
```

Returns the `AccountId` of the account that created/sent the note. In our bank:

- The sender is the depositor
- Their ID is used to credit their balance

### get_initial_assets() - Attached Assets

```rust
let assets = active_note::get_initial_assets();
for asset in assets {
    // Process each asset
}
```

Returns a `Vec<Asset>` containing all assets initially attached to the note. The `for` loop consumes that vector.

### get_storage() - Note Parameters

```rust
let storage = active_note::get_storage();
let first_item = storage[0];
```

Returns a `Vec<Felt>` containing the storage items passed when the note was created. The indexing example requires at least one item. We'll use storage items in the withdraw request note (Part 7).

## Step 4: Build the Note Script

:::info Dependencies Build Automatically
Compiler 0.10 resolves and builds the `bank-account` dependency before compiling the note. The `#[account(...)]` macro uses the bank's compiled interface and procedure roots to bind calls to its methods. You can build the note directly using the dependency declaration in `miden-project.toml`.
:::

From the project root:

```bash title=">_ Terminal"
cd contracts/deposit-note
miden build --release
cd ../..
```

<details>
<summary>Expected output</summary>

```text
   Compiling deposit-note v0.1.0
    Finished `release` profile [optimized] target(s)
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
   assets = get_initial_assets() → [100 tokens]
   account.deposit(depositor, 100 tokens)

4. Bank's deposit() method executes
   - Validates asset type and amount
   - Checks initialization once the guard is enabled in Part 6
   - Updates balance: balances[User] += 100
   - Adds asset to vault
```

## Try It: Verify Deposits Work

This test verifies the deposit flow end-to-end — building the contracts, initializing the bank, creating a deposit, and checking the balance.

:::note Preview of the Part 6 Initialization Flow
The bank inherited from Part 3 still has `require_initialized()` commented out, so deposits currently work without initialization. In [Part 6](./06-transaction-scripts.md), we'll create the initialization transaction script and enable the guard, making initialization mandatory. The test below previews that flow: it initializes the bank, consumes a deposit note, and checks the depositor's balance. Run it after completing Part 6, or use the complete example projects from the repository.
:::

Create the test file:

:::note Illustrative snippet
The snippet below illustrates the deposit happy-path. The shipped repository's `examples/miden-bank/integration/tests/deposit_test.rs` is the source of truth and additionally exercises failure paths (`deposit_exceeds_max_should_fail`, `deposit_without_init_should_fail`).
:::

```rust title="integration/tests/deposit_test.rs"
use integration::helpers::{
    build_project_in_dir, build_tx_script_from_package, create_testing_account_from_package,
    create_testing_note_from_package, AccountCreationConfig, NoteCreationConfig,
};

use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    auth::AuthScheme,
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
            auth_scheme: AuthScheme::Falcon512Poseidon2,
        },
        "TEST",
        1000,
        Some(10),
    )?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth {
            auth_scheme: AuthScheme::Falcon512Poseidon2,
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
    // Preview the Part 6 flow, where require_initialized() is enabled.
    // Initialize via a transaction script that calls bank.initialize().

    let init_tx_script = build_tx_script_from_package(init_tx_script_package.as_ref())?;

    let init_tx_context = mock_chain
        .build_transaction(bank_account.id())
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;
    bank_account = mock_chain.committed_account(bank_account.id())?.clone();

    println!("Bank initialized successfully");

    // *********************************************************************************
    // STEP 2: DEPOSIT
    // *********************************************************************************

    // Build the transaction context where bank consumes the deposit note
    let tx_context = mock_chain
        .build_transaction(bank_account.id())
        .authenticated_input_note(deposit_note.id())
        .build()?;

    // Execute the transaction
    let executed_transaction = tx_context.execute().await?;

    // Add the executed transaction to the mockchain and prove
    mock_chain.add_pending_executed_transaction(&executed_transaction)?;
    mock_chain.prove_next_block()?;
    bank_account = mock_chain.committed_account(bank_account.id())?.clone();

    // Create the key for the depositor (sender) in the storage map.
    // Key format: [depositor_prefix, depositor_suffix, asset.key[3], asset.key[2]].
    // In v0.16 the fungible-asset vault key is
    // [asset_class_suffix, asset_class_prefix, faucet_suffix | metadata_byte, faucet_prefix],
    // so `key[2]` is the faucet suffix combined with composition metadata,
    // not the raw faucet suffix. Derive the read key from the asset's
    // actual key word so it matches the key the contract writes.
    let asset_key_word = FungibleAsset::new(faucet.id(), deposit_amount)?.to_id_word();
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        asset_key_word[3],
        asset_key_word[2],
    ]);

    // Get the depositor's balance from the bank's storage using named slot
    let balance = bank_account.storage().get_map_item(&balances_slot, miden_client::account::StorageMapKey::new(depositor_key))?;

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

running 1 test
Bank initialized successfully
Deposit test passed! Deposited 1000 tokens
test deposit_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

## Preview: Withdraw Request Note

For withdrawals, we'll use note inputs to pass parameters. Here's a preview of the withdraw request note (implemented in Part 7):

```rust title="contracts/withdraw-request-note/src/lib.rs (preview)"
/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Withdraw Request Note Script
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset, encoded as [amount, 0, faucet_suffix(+metadata), faucet_prefix].
///        `storage[2]` carries the faucet suffix with the asset's metadata byte in its
///        low 8 bits (host side: `FungibleAsset::to_id_word()[2]`), not the raw suffix.
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 0 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed)
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

        // Asset: reconstruct the v0.16 fungible-asset ID/value from the note storage.
        // key   = [0, 0, storage[2], storage[3]] where storage[2] = faucet suffix + metadata
        //         byte (low 8 bits) and storage[3] = faucet prefix.
        // value = [amount, 0, 0, 0]
        let withdraw_asset = Asset::new(
            Word::from([felt!(0), felt!(0), storage[2], storage[3]]),
            Word::from([storage[0], felt!(0), felt!(0), felt!(0)]),
        );

        let serial_num = Word::from([storage[4], storage[5], storage[6], storage[7]]);

        let tag = storage[8];
        let note_type = storage[9];

        // Note: P2ID script root (storage[10..13]) is read by the bank account directly
        // from the active note's storage inside `Bank::withdraw`.

        // The bank identifies the depositor internally via `active_note::get_sender()`,
        // which is cryptographically bound to this note's metadata and cannot be spoofed.
        account.withdraw(withdraw_asset, serial_num, tag, note_type);
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
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Deposit Note Script
///
/// When consumed by the Bank account, this note transfers all its assets
/// to the bank and credits the depositor (note sender) with the deposited amount.
#[note]
struct DepositNote;

#[note]
impl DepositNote {
    #[note_script]
    fn run(self, _arg: Word, account: &mut Wallet) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get all assets attached to this note
        let assets = active_note::get_initial_assets();

        // Deposit each asset into the bank
        for asset in assets {
            account.deposit(depositor, asset);
        }
    }
}
```

</details>

## Key Takeaways

1. **`#[note]`** marks the struct and impl block, with **`#[note_script]`** on the entry point method `fn run(self, _arg: Word, account: &mut Wallet)`
2. **`#[account(bank_account::Bank)] pub struct Wallet;`** wraps the consuming account so the note can call the bank's methods via `account.deposit(...)`
3. **`active_note::get_sender()`** returns who created the note
4. **`active_note::get_initial_assets()`** returns the assets attached to the note at creation time
5. **`active_note::get_storage()`** returns parameterized data
6. **Note scripts execute once** when consumed - no persistent state
7. **Dependencies build automatically** - declare the account component in `miden-project.toml`, then build the note with `miden build`

:::tip View Complete Source
See the complete note script implementations:

- [Deposit Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/deposit-note/src/lib.rs)
- [Withdraw Request Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/withdraw-request-note/src/lib.rs)
  :::

## Next Steps

Now that you understand note scripts, let's learn how they call account methods in [Part 5: Cross-Component Calls](./cross-component-calls).
