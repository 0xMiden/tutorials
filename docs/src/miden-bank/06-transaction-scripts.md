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
| Parameter  | `account: &mut Account`            | Note context via `active_note::` |

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

## Step 2: Configure Cargo.toml

Create the Cargo.toml with transaction script configuration:

```toml title="contracts/init-tx-script/Cargo.toml"
[package]
name = "init-tx-script"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { version = "0.12" }

[package.metadata.component]
package = "miden:init-tx-script"

[package.metadata.miden]
project-kind = "transaction-script"

[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }

[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

Key configuration:

- `project-kind = "transaction-script"` - Marks this as a transaction script (not "account" or "note")
- Dependencies reference the account component (same pattern as note scripts)

## Step 3: Add to Workspace

Update your root `Cargo.toml` to include the new project:

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

## Step 4: Implement the Transaction Script

Create the initialization script:

```rust title="contracts/init-tx-script/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the Account binding which wraps the bank-account component methods
use crate::bindings::Account;

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
#[tx_script]
fn run(_arg: Word, account: &mut Account) {
    account.initialize();
}
```

## The #[tx_script] Attribute

The `#[tx_script]` attribute marks the entry point for a transaction script:

```rust
#[tx_script]
fn run(_arg: Word, account: &mut Account) {
    account.initialize();
}
```

### Function Signature

| Parameter | Type           | Description                                |
| --------- | -------------- | ------------------------------------------ |
| `_arg`    | `Word`         | Optional argument passed when executing    |
| `account` | `&mut Account` | Mutable reference to the account component |

The `Account` type is generated from your component's bindings and provides access to all public methods.

## The Account Binding

Unlike note scripts that import bindings like `bank_account::deposit()`, transaction scripts receive the account as a parameter:

```rust
// Note script style (indirect):
use crate::bindings::miden::bank_account::bank_account;
bank_account::deposit(depositor, asset);

// Transaction script style (direct):
use crate::bindings::Account;
fn run(_arg: Word, account: &mut Account) {
    account.initialize();  // Direct method call
}
```

The `Account` wrapper provides:

- Direct method access without module prefixes
- Proper mutable/immutable borrowing
- Automatic context binding

## Step 5: Build the Transaction Script

Build in dependency order:

```bash title=">_ Terminal"
# First, ensure the account component is built (generates WIT files)
cd contracts/bank-account
miden build

# Then build the transaction script
cd ../init-tx-script
miden build
```

<details>
<summary>Expected output</summary>

```text
   Compiling init-tx-script v0.1.0
    Finished `release` profile [optimized] target(s)
Creating Miden package /path/to/miden-bank/target/miden/release/init_tx_script.masp
```

</details>

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
fn run(arg: Word, account: &mut Account) {
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

Let's test that the initialization transaction script enables deposits.

Create a test file:

```rust title="integration/tests/part6_tx_script_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};
use miden_client::account::{StorageMap, StorageSlot, StorageSlotName};
use miden_client::Word;
use miden_client::transaction::TransactionScript;
use miden_testing::MockChain;
use std::{path::Path, sync::Arc};

/// Test that the init-tx-script properly initializes the bank account
#[tokio::test]
async fn test_init_tx_script_enables_deposits() -> anyhow::Result<()> {
    // Build all required packages
    let mut builder = MockChain::builder();

    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    let init_tx_script_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/init-tx-script"),
        true,
    )?);

    // Create uninitialized bank account with named storage slots
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

    // Verify bank is NOT initialized
    let initial_storage = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        initial_storage[0].as_canonical_u64(),
        0,
        "Bank should start uninitialized"
    );

    println!("Step 1: Bank starts uninitialized (storage[0] = 0)");

    // Add bank to mock chain
    builder.add_account(bank_account.clone())?;
    let mut mock_chain = builder.build()?;

    // Create the TransactionScript from our init-tx-script
    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new((*init_program).clone());

    // Build and execute the initialization transaction
    let init_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[], &[])?
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    bank_account.apply_delta(&executed_init.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;

    // Verify bank IS now initialized
    let final_storage = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        final_storage[0].as_canonical_u64(),
        1,
        "Bank should be initialized after tx script"
    );

    println!("Step 2: Bank initialized via transaction script (storage[0] = 1)");
    println!("\nPart 6 transaction script test passed!");

    Ok(())
}
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_init_tx_script_enables_deposits -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part6_tx_script_test.rs

running 1 test
✓ Bank successfully initialized via transaction script
  Storage[0] changed from [0,0,0,0] to [1,0,0,0]
  Bank is now ready to accept deposits!
test test_init_tx_script_enables_deposits ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::tip Troubleshooting
**"Cannot find module bindings"**: The bank-account wasn't built. Run `miden build` in `contracts/bank-account` first.

**"Dependency not found"**: Check that both dependency sections are in Cargo.toml with correct paths.
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

// Import the Account binding which wraps the bank-account component methods
use crate::bindings::Account;

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
#[tx_script]
fn run(_arg: Word, account: &mut Account) {
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
miden = { version = "0.12" }

[package.metadata.component]
package = "miden:init-tx-script"

[package.metadata.miden]
project-kind = "transaction-script"

[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }

[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

</details>

## Key Takeaways

1. **`#[tx_script]`** marks the entry point with signature `fn run(_arg: Word, account: &mut Account)`
2. **Direct account access** - Methods called on the `account` parameter, not via module imports
3. **Owner-initiated** - Only the account owner can execute transaction scripts
4. **Deployment pattern** - First state change makes account visible on-chain
5. **Dependencies** - Same Cargo.toml configuration as note scripts

:::tip View Complete Source
See the complete transaction script implementation in [contracts/init-tx-script/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/init-tx-script/src/lib.rs).
:::

## Next Steps

Now that you understand transaction scripts, let's learn the advanced topic of creating output notes in [Part 7: Creating Output Notes](./output-notes).
