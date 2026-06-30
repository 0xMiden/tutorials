---
sidebar_position: 6
title: "Part 6: Transaction Scripts"
description: "Learn how to write transaction scripts for account initialization and owner-controlled operations using the #[tx_script] attribute."
---

# Part 6: Transaction Scripts

In this section, you'll learn how to write transaction scripts - code that the account owner explicitly executes. We'll implement an initialization script that enables the bank to accept deposits.

## What You'll Build in This Part

By the end of this section, you will have:

- Created the `init-tx-script` transaction script project
- Understood the `#[tx_script]` attribute and function signature
- Learned the difference between transaction scripts and note scripts
- **Verified initialization works** via a MockChain test

## Building on Part 5

In Parts 4-5, you created note scripts that execute when notes are consumed. Now you'll create a transaction script - code the account owner explicitly runs:

```text
┌────────────────────────────────────────────────────────────────┐
│                 Script Types Comparison                         │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Note Scripts (Parts 4-5)          Transaction Scripts (Part 6)│
│   ─────────────────────────         ────────────────────────────│
│   • Triggered by note consumption   • Explicitly called by owner│
│   • Import bindings via modules     • Receive account parameter │
│   • Process incoming assets         • Setup, admin operations   │
│                                                                 │
│   deposit-note/                     init-tx-script/             │
│   └── calls bank_account::deposit() └── calls account.initialize()
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Transaction Scripts vs Note Scripts

| Aspect     | Transaction Script                 | Note Script                      |
| ---------- | ---------------------------------- | -------------------------------- |
| Initiation | Explicitly called by account owner | Triggered when note is consumed  |
| Access     | Direct account method access       | Must call through bindings       |
| Use case   | Setup, owner operations            | Receiving messages/assets        |
| Parameter  | `account: &mut Wallet`             | Note context via `active_note::` |

**Use transaction scripts for:**

- One-time initialization
- Admin/owner operations
- Operations that don't involve receiving notes

**Use note scripts for:**

- Receiving assets from other accounts
- Processing requests from other accounts
- Multi-party interactions

## Step 1: Create the Transaction Script Project

Create a new directory for the transaction script:

```bash title=">_ Terminal"
mkdir -p contracts/init-tx-script/src
```

## Step 2: Configure the Project Files

Like the account component and the note scripts, a transaction script needs three project files: `Cargo.toml`, `miden-project.toml`, and `.cargo/config.toml`.

Create the `Cargo.toml`:

```toml title="contracts/init-tx-script/Cargo.toml"
[package]
name = "init-tx-script"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { git = "https://github.com/0xMiden/compiler", rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b" }
```

Create the `miden-project.toml`:

```toml title="contracts/init-tx-script/miden-project.toml"
[package]
name = "init-tx-script"
version = "0.1.0"

[lib]
kind = "tx-script"
namespace = "miden:base/transaction-script@1.0.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
```

Create the `.cargo/config.toml`:

```toml title="contracts/init-tx-script/.cargo/config.toml"
[build]
target = "wasm32-wasip2"

[target.wasm32-wasip2]
rustflags = ["--cfg", "miden"]
```

Key configuration:

- `kind = "tx-script"` - Marks this as a transaction script (not `account-component` or `note`)
- `namespace = "miden:base/transaction-script@1.0.0"` - The standard transaction-script namespace
- The `bank-account` path dependency plus the `[package.metadata.miden.dependencies]` WIT entry let the script call into the account component (same pattern as the note scripts)

## Step 3: Implement the Transaction Script

Create the initialization script:

```rust title="contracts/init-tx-script/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Native (active) account this tx-script runs against: the bank-account `Bank` component.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Initialize Transaction Script
///
/// This transaction script initializes the bank account, enabling deposits.
/// It must be executed by the bank account owner before any deposits can be made.
///
/// # Flow
/// 1. Transaction is created with this script attached
/// 2. Script executes in the context of the bank account
/// 3. Calls `account.initialize()` to enable deposits
/// 4. Bank account is now "deployed" and visible on chain
///
/// # Arguments
/// * `_arg` - Transaction script argument (unused in this script)
/// * `account` - Mutable reference to the bank account (`Bank` component)
#[tx_script]
fn run(_arg: Word, account: &mut Wallet) {
    account.initialize();
}
```

## The #[account] Attribute and the Native Account

A transaction script runs against the transaction's _native_ (active) account. The `#[account(...)]` attribute binds a wrapper struct to a component so the script can call that component's methods directly:

```rust
/// Native (active) account this tx-script runs against: the bank-account `Bank` component.
#[account(bank_account::Bank)]
pub struct Wallet;
```

This generates a `Wallet` type that wraps the bank-account `Bank` component. The `#[tx_script]` function then receives a `&mut Wallet`, giving it direct access to the component's public methods (such as `initialize()`).

## The #[tx_script] Attribute

The `#[tx_script]` attribute marks the entry point for a transaction script:

```rust
#[tx_script]
fn run(_arg: Word, account: &mut Wallet) {
    account.initialize();
}
```

### Function Signature

| Parameter | Type          | Description                             |
| --------- | ------------- | --------------------------------------- |
| `_arg`    | `Word`        | Optional argument passed when executing |
| `account` | `&mut Wallet` | Mutable reference to the native account |

The `Wallet` type is generated by the `#[account(...)]` attribute and provides access to the bound component's public methods.

## The Native Account Binding

Both note scripts and transaction scripts bind the native account with `#[account(bank_account::Bank)]` and call its methods directly on the `&mut Wallet` parameter. The difference is the trigger and the available context:

```rust
// Note script: triggered by note consumption, has access to note context.
#[note_script]
fn run(self, _arg: Word, account: &mut Wallet) {
    let depositor = active_note::get_sender();  // note context
    account.deposit(depositor, asset);          // native-account method
}

// Transaction script: explicitly run by the owner, no note context.
#[tx_script]
fn run(_arg: Word, account: &mut Wallet) {
    account.initialize();  // native-account method
}
```

The `Wallet` wrapper provides:

- Direct method access without module prefixes
- Proper mutable/immutable borrowing
- Automatic native-account context binding

## Step 4: Build the Transaction Script

Build in dependency order. The transaction script calls into the bank account via the FPI `#[account(...)]` macro, which reads the account's procedure roots from its compiled `.masp` at build time, so the `bank-account` component must be built first:

```bash title=">_ Terminal"
# First, build the account component (generates WIT files and its .masp)
cd contracts/bank-account
cargo miden build --release

# Then build the transaction script
cd ../init-tx-script
cargo miden build --release
```

<details>
<summary>Expected output</summary>

```text
   Compiling init-tx-script v0.1.0
    Finished `release` profile [optimized] target(s)
Creating Miden package .../init-tx-script/target/miden/release/init_tx_script.masp
```

</details>

:::note Cosmetic build errors
The part2 compiler prints non-fatal `MAST`-serialization `ERROR` lines on every build. They are cosmetic — the build still succeeds and produces the `.masp` package.
:::

## Account Deployment Pattern

In Miden, accounts are only visible on-chain after their first state change. Transaction scripts are commonly used for this "deployment":

```text
Execution Flow:

1. Account owner creates transaction with init-tx-script
   ┌───────────────────────────────────────┐
   │ Transaction                           │
   │  Account: Bank's AccountId            │
   │  Script: init-tx-script               │
   └───────────────────────────────────────┘

2. Transaction executes
   ┌───────────────────────────────────────┐
   │ run(_arg, account)                    │
   │  └─ account.initialize()              │
   │       └─ Sets initialized flag to 1   │
   └───────────────────────────────────────┘

3. Account state updated
   ┌───────────────────────────────────────┐
   │ Bank Account                          │
   │  Storage[0] = [1, 0, 0, 0]  ← Initialized
   │  Now visible on-chain                 │
   └───────────────────────────────────────┘
```

Before initialization:

- Account exists locally but isn't visible on the network
- Cannot receive notes or interact with other accounts

After initialization:

- Account is "deployed" and visible
- Can receive deposits and interact normally

## Using Script Arguments

The `_arg` parameter can pass data to the script:

```rust title="Example: Parameterized script"
#[tx_script]
fn run(arg: Word, account: &mut Wallet) {
    // Use arg as configuration
    let config_value = arg[0];
    account.configure(config_value);
}
```

When creating the transaction, provide the argument:

```rust title="Integration code (not contract code)"
let tx_script_args = Word::from([felt!(42), felt!(0), felt!(0), felt!(0)]);
let tx_context = mock_chain
    .build_tx_context(bank_account.id(), &[], &[])?
    .tx_script(init_tx_script)
    .tx_script_args(tx_script_args)  // Pass the argument
    .build()?;
```

## Try It: Verify Initialization Works

Let's test that the initialization transaction script correctly flips the initialized flag. The companion test file `integration/tests/init_test.rs` verifies exactly this:

```rust title="integration/tests/init_test.rs"
use integration::helpers::{
    build_project_in_dir, build_tx_script_from_package, create_testing_account_from_package,
    AccountCreationConfig,
};

use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    auth::AuthSchemeId,
    Word,
};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Companion test for Part 6 of the miden-bank tutorial. Verifies that running
/// the init transaction script flips the bank's `initialized` flag from 0 to 1.
///
/// The earlier tutorial parts rely on the bank deferring `require_initialized()`
/// enforcement, so this test exists to prove that once the guard is re-enabled
/// the init flow still works end-to-end before any deposits are accepted.
#[tokio::test]
async fn init_test() -> anyhow::Result<()> {
    // Build the bank-account and init-tx-script contracts
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    let init_tx_script_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/init-tx-script"),
        true,
    )?);

    // The `initialized` value slot has no schema default, so `AccountComponent::from_package`
    // requires it to be seeded (with a zero Word = uninitialized) or it errors with
    // `InitValueNotProvided`. The `balances` map slot defaults to empty.
    let initialized_slot = StorageSlotName::new("bank_account::bank::initialized")
        .expect("Valid slot name");

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

    // Verify bank starts uninitialized
    let before = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(before[0].as_canonical_u64(), 0, "Bank should start uninitialized");
    println!("Before init: initialized = {}", before[0].as_canonical_u64());

    // Build mock chain
    let mut builder = MockChain::builder();
    builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        10_000_000,
        Some(10),
    )?;
    builder.add_account(bank_account.clone())?;
    let mut mock_chain = builder.build()?;

    // Execute init transaction script
    let init_tx_script = build_tx_script_from_package(init_tx_script_package.as_ref())?;

    let init_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[], &[])?
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    bank_account.apply_delta(&executed_init.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;

    // Verify initialized flag flipped to 1
    let after = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        after[0].as_canonical_u64(),
        1,
        "Bank should be initialized after running init tx script"
    );
    println!("After init: initialized = {}", after[0].as_canonical_u64());

    println!("\nInit test passed!");
    Ok(())
}
```

A few things to note in this test:

- The slot name is `bank_account::bank::initialized` (the namespace is `bank_account`, not `miden_bank_account`).
- The `initialized` value slot has **no schema default**, so it must be seeded via `InitStorageData` or `AccountComponent::from_package` errors with `InitValueNotProvided`. Only the `balances` map slot defaults to empty.
- A `kind = "tx-script"` contract compiles to a `TransactionScript`-kind package, **not** an `Executable`. So `unwrap_program()` / `TransactionScript::from_package` do not apply — the `build_tx_script_from_package` helper locates the entry export and builds the script via `TransactionScript::from_parts`.

## Enable the Initialization Guard

Now that we have the init transaction script, it's time to enable the `require_initialized()` guard that we've had commented out since Part 2. Open `contracts/bank-account/src/lib.rs` and uncomment the guard in both the `deposit()` and `withdraw()` methods:

**Before (Parts 2-5):**

```rust
    // NOTE: Initialization guard — enabled in Part 6 (Transaction Scripts)
    // self.require_initialized();
```

**After (Part 6 onward):**

```rust
    self.require_initialized();
```

With this change, deposits and withdrawals will fail unless the bank has been initialized via the transaction script. This is a critical security measure — it prevents assets from being deposited into an uninitialized bank.

## Try It: Verify Initialization

Run the companion init test to verify the transaction script correctly flips the initialized flag:

```bash title=">_ Terminal"
cargo test --package integration --test init_test -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/init_test.rs

running 1 test
Before init: initialized = 0
After init: initialized = 1

Init test passed!
test init_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::tip Expected Output
Your actual output may include additional trace lines from the Miden VM or MockChain. As long as you see the test passing, these can be safely ignored.
:::

:::tip Troubleshooting
**"Cannot find module bindings"**: The bank-account wasn't built. Run `cargo miden build --release` in `contracts/bank-account` first — the FPI `#[account(...)]` macro reads its procedure roots from the compiled `.masp`.

**"Dependency not found"**: Check that the `bank-account` path dependency and the `[package.metadata.miden.dependencies]` WIT entry are both present in `miden-project.toml` with correct paths.
:::

:::note Live network bin
The MockChain test above is the source of truth for verifying this flow. The live-network bin (`cargo run --bin initialize`) also runs against a testnet node.
:::

## What We've Built So Far

| Component               | Status      | Description                                     |
| ----------------------- | ----------- | ----------------------------------------------- |
| `bank-account`          | ✅ Complete | Full deposit logic with storage and constraints |
| `deposit-note`          | ✅ Complete | Note script that calls deposit method           |
| `init-tx-script`        | ✅ Complete | Transaction script for initialization           |
| `withdraw-request-note` | Not started | Coming in Part 7                                |

## Complete Code for This Part

<details>
<summary>Click to see the complete init-tx-script code</summary>

```rust title="contracts/init-tx-script/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Native (active) account this tx-script runs against: the bank-account `Bank` component.
#[account(bank_account::Bank)]
pub struct Wallet;

/// Initialize Transaction Script
///
/// This transaction script initializes the bank account, enabling deposits.
/// It must be executed by the bank account owner before any deposits can be made.
///
/// # Flow
/// 1. Transaction is created with this script attached
/// 2. Script executes in the context of the bank account
/// 3. Calls `account.initialize()` to enable deposits
/// 4. Bank account is now "deployed" and visible on chain
///
/// # Arguments
/// * `_arg` - Transaction script argument (unused in this script)
/// * `account` - Mutable reference to the bank account (`Bank` component)
#[tx_script]
fn run(_arg: Word, account: &mut Wallet) {
    account.initialize();
}
```

```toml title="contracts/init-tx-script/Cargo.toml"
[package]
name = "init-tx-script"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { git = "https://github.com/0xMiden/compiler", rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b" }
```

```toml title="contracts/init-tx-script/miden-project.toml"
[package]
name = "init-tx-script"
version = "0.1.0"

[lib]
kind = "tx-script"
namespace = "miden:base/transaction-script@1.0.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
```

```toml title="contracts/init-tx-script/.cargo/config.toml"
[build]
target = "wasm32-wasip2"

[target.wasm32-wasip2]
rustflags = ["--cfg", "miden"]
```

</details>

## Key Takeaways

1. **`#[tx_script]`** marks the entry point with signature `fn run(_arg: Word, account: &mut Wallet)`
2. **`#[account(...)]`** binds a `Wallet` wrapper to the native account's component, enabling direct method calls
3. **Direct account access** - Methods called on the `account` parameter, not via module imports
4. **Owner-initiated** - Only the account owner can execute transaction scripts
5. **Deployment pattern** - First state change makes account visible on-chain
6. **TransactionScript-kind package** - Unlike an executable, the compiled tx-script is extracted with `build_tx_script_from_package`

:::tip View Complete Source
See the complete transaction script implementation in [contracts/init-tx-script/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/init-tx-script/src/lib.rs).
:::

## Next Steps

Now that you understand transaction scripts, let's learn the advanced topic of creating output notes in [Part 7: Creating Output Notes](./output-notes).
