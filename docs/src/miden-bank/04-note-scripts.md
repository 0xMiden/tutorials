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
miden = { git = "https://github.com/0xMiden/compiler", rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b" }
```

Create the `miden-project.toml`. This is where the note declares its kind and its dependency on the bank account it calls into:

```toml title="contracts/deposit-note/miden-project.toml"
[package]
name = "deposit-note"
version = "0.1.0"

[lib]
kind = "note"
namespace = "miden:deposit-note/miden-deposit-note@0.1.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

# WIT for the account component this note calls, produced by building bank-account.
[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
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
- `bank-account = { path = "../bank-account" }` and the `[package.metadata.miden.dependencies]` `wit` entry declare the account component this note calls; the `wit` path points at the WIT files produced when `bank-account` is built

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
        let assets = active_note::get_assets();

        // Deposit each asset into the bank
        for asset in assets {
            account.deposit(depositor, asset);
        }
    }
}
```

:::info Cross-Component Calls
The `#[account(bank_account::Bank)] pub struct Wallet;` declaration and the `account.deposit(...)` call use Miden's cross-component binding system. The `#[account(...)]` macro wraps the consuming account so the note can call the bank's `Bank` methods directly. We'll explain exactly how this works in [Part 5: Cross-Component Calls](./cross-component-calls). For now, just know that building `bank-account` first generates the WIT files that `deposit-note` binds against.
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

## Step 4: Build the Note Script

:::info Build Order Matters
Build account components **first** before building note scripts that depend on them. The note script needs the generated WIT files from the account, and the FPI `#[account(...)]` macro reads the bank account's procedure roots from its compiled `.masp` at compile time.
:::

```bash title=">_ Terminal"
# First, ensure bank-account is built (generates WIT + the .masp the note binds against)
cd contracts/bank-account
cargo miden build --release

# Now build the deposit note
cd ../deposit-note
cargo miden build --release
```

<details>
<summary>Expected output</summary>

```text
   Compiling deposit-note v0.1.0
    Finished `release` profile [optimized] target(s)
Creating Miden package /path/to/miden-bank/target/miden/release/deposit_note.masp
```

</details>

:::note Cosmetic MAST-serialization errors
The part2 compiler prints non-fatal `ERROR` lines about `MAST` serialization on every build. They are cosmetic — the build still succeeds and produces the `.masp` package.
:::

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
   account.deposit(depositor, 100 tokens)

4. Bank's deposit() method executes
   - Validates initialization and amount
   - Updates balance: balances[User] += 100
   - Adds asset to vault
```

## Try It: Verify Deposits Work

First, verify your deposit-note builds successfully:

```bash title=">_ Terminal"
# Ensure bank-account is built first
cd contracts/bank-account && cargo miden build --release

# Then build deposit-note
cd ../deposit-note && cargo miden build --release
```

This is the first runnable test in the tutorial. It verifies the deposit flow end-to-end — building the bank and deposit-note contracts, creating a deposit, and checking the balance.

:::note Initialization happens before deposits
The bank's `require_initialized()` guard is active, so a deposit only succeeds once the bank has been initialized. The shipped `deposit_test.rs` initializes the bank first via the init transaction script (which we build in Part 6). The illustrative excerpt below omits that step to keep the focus on the deposit and note-script mechanics; see the shipped test for the complete init-then-deposit flow.
:::

Create the test file:

:::note Illustrative snippet
The snippet below illustrates the deposit happy-path. The shipped repository's `examples/miden-bank/integration/tests/deposit_test.rs` is the source of truth and additionally exercises failure paths (`deposit_exceeds_max_should_fail`, `deposit_without_init_should_fail`).
:::

```rust title="integration/tests/deposit_test.rs (illustrative — see shipped file for the full version)"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package,
    create_testing_note_from_package, AccountCreationConfig, NoteCreationConfig,
};
use miden_client::account::{component::{InitStorageData, StorageValueName}, StorageSlotName};
use miden_client::asset::{Asset, FungibleAsset};
use miden_client::auth::AuthSchemeId;
use miden_client::note::NoteAssets;
use miden_client::transaction::RawOutputNote;
use miden_client::{Felt, Word};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

#[tokio::test]
async fn deposit_test() -> anyhow::Result<()> {
    // =========================================================================
    // SETUP: Build contracts and create mock chain
    // =========================================================================
    let mut builder = MockChain::builder();

    // Create a faucet for test tokens
    let faucet = builder.add_existing_basic_faucet(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, "TEST", 1000, Some(10))?;

    // Create sender (depositor) wallet
    let sender = builder.add_existing_wallet_with_assets(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, [FungibleAsset::new(faucet.id(), 100)?.into()])?;

    // Build bank-account and deposit-note (the shipped test also builds init-tx-script; omitted here for brevity)
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    let deposit_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/deposit-note"),
        true,
    )?);

    // Create the bank account with storage slots.
    //
    // The shipped deposit_test.rs initializes the bank first (via the init
    // transaction script built in Part 6) because `require_initialized()` is
    // active; this excerpt omits that step and focuses on the deposit flow.
    let initialized_slot =
        StorageSlotName::new("bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("bank_account::bank::balances")
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

    // Create the deposit note
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

    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));
    let mut mock_chain = builder.build()?;

    // =========================================================================
    // EXECUTE DEPOSIT (the shipped test initializes the bank first; this excerpt omits that step)
    // =========================================================================
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
        "Balance should equal deposited amount"
    );

    println!("\nPart 4 deposit test passed!");
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
test deposit_test ... ok
test deposit_exceeds_max_should_fail ... ok
test deposit_without_init_should_fail ... ok

test result: ok. 3 passed; 0 failed; 0 ignored
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
///        low 8 bits (host side: `FungibleAsset::to_key_word()[2]`), not the raw suffix.
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
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

        // Asset: reconstruct the v0.15 fungible-asset key/value from the note storage.
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
        let assets = active_note::get_assets();

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
4. **`active_note::get_assets()`** returns assets attached to the note
5. **`active_note::get_storage()`** returns parameterized data
6. **Note scripts execute once** when consumed - no persistent state
7. **Build order matters** - account components first, then note scripts

:::tip View Complete Source
See the complete note script implementations:

- [Deposit Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/deposit-note/src/lib.rs)
- [Withdraw Request Note](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/withdraw-request-note/src/lib.rs)
  :::

## Next Steps

Now that you understand note scripts, let's learn how they call account methods in [Part 5: Cross-Component Calls](./cross-component-calls).
