---
sidebar_position: 0
title: "Part 0: Project Setup"
description: "Set up a new Miden project and prepare the workspace for building the banking application."
---

# Part 0: Project Setup

In this section, you'll create a new Miden project and set up the workspace structure for our banking application. By the end, you'll have a working project that compiles successfully.

## What You'll Build in This Part

By the end of this section, you will have:

- Created a new Miden project using `miden new`
- Understood the workspace structure
- Renamed and configured the project for our bank
- Successfully compiled a minimal account component

## Prerequisites

Before starting, ensure you have completed the [Get Started installation guide](https://docs.miden.xyz/builder/get-started/setup/installation) and have:

- **Rust toolchain** installed and configured
- **midenup toolchain** installed with Miden CLI tools (`miden` command available)

Verify your installation:

```bash title=">_ Terminal"
miden --version
```

<details>
<summary>Expected output</summary>

```text
The Miden toolchain porcelain:

Environment:
- cargo version: cargo 1.93.0 (083ac5135 2025-12-15).

Midenup:
- midenup + miden version: 0.1.0.
- active toolchain version: 0.20.3.
- ...
```

</details>

## Step 1: Create the Project

Create a new Miden project using the CLI:

```bash title=">_ Terminal"
miden new miden-bank
cd miden-bank
```

This creates a workspace with the following structure:

```text
miden-bank/
├── contracts/                   # Smart contract code
│   ├── counter-account/         # Example account contract (we'll replace this)
│   └── increment-note/          # Example note script (we'll replace this)
├── integration/                 # Tests and deployment scripts
│   ├── src/
│   │   ├── bin/                 # Executable scripts for on-chain interactions
│   │   ├── lib.rs
│   │   └── helpers.rs           # Helper functions for tests
│   └── tests/                   # Test files
├── Cargo.toml                   # Workspace root
└── rust-toolchain.toml          # Rust toolchain specification
```

The project follows Miden's design philosophy:

- **`contracts/`**: Your smart contract code (account components, note scripts, transaction scripts)
- **`integration/`**: All on-chain interactions, deployment scripts, and tests

## Step 2: Set Up the Bank Account Contract

We'll replace the example `counter-account` with our `bank-account`. First, rename the directory:

```bash title=">_ Terminal"
mv contracts/counter-account contracts/bank-account
```

A contract is configured by three files: a minimal Cargo manifest, a Miden project manifest, and a Cargo build config.

First, update the `Cargo.toml` inside `contracts/bank-account/`. It only needs the `miden` guest dependency and the `cdylib` crate type:

```toml title="contracts/bank-account/Cargo.toml"
[package]
name = "bank-account"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
miden = { git = "https://github.com/0xMiden/compiler", rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b" }
```

Next, create `contracts/bank-account/miden-project.toml`. This is the Miden-specific project manifest that tells the compiler what kind of artifact to build and which package namespace to export:

```toml title="contracts/bank-account/miden-project.toml"
[package]
name = "bank-account"
version = "0.1.0"

[lib]
kind = "account-component"
namespace = "miden:bank-account/bank@0.1.0"

[dependencies]
miden-core = "*"
miden-protocol = "*"

[package.metadata.miden]
supported-types = ["RegularAccountImmutableCode"]
```

Finally, create `contracts/bank-account/.cargo/config.toml` so the contract always builds for the WebAssembly target with the `miden` cfg enabled (this also makes editor/LSP workflows resolve the right code):

```toml title="contracts/bank-account/.cargo/config.toml"
[build]
target = "wasm32-wasip2"

[target.wasm32-wasip2]
# Force-enable `cfg(miden)` for Miden-VM-targeted builds (including editor/LSP workflows).
rustflags = ["--cfg", "miden"]
```

### Key Configuration Options

| Field                                       | File                 | Description                                          |
| ------------------------------------------- | -------------------- | ---------------------------------------------------- |
| `crate-type = ["cdylib"]`                   | `Cargo.toml`         | Required for WebAssembly compilation                 |
| `kind = "account-component"`                | `miden-project.toml` | Tells the compiler this is an account component      |
| `namespace = "miden:bank-account/bank@..."` | `miden-project.toml` | The package namespace used for cross-component calls |
| `supported-types`                           | `miden-project.toml` | Account types this component supports                |
| `target = "wasm32-wasip2"`                  | `.cargo/config.toml` | Compile target for the Miden VM                      |

:::info Supported Account Types
`RegularAccountImmutableCode` means the account code cannot be changed after deployment. This is appropriate for our bank since we want the logic to be fixed.
:::

:::note Toolchain
This tutorial targets protocol v0.15 and pins the Miden compiler to a specific commit (`rev = "97eb019ded3a2d1f29d77639190bad5d3f0f099b"`) of its v0.15 line — the cross-component / sibling-call work, merged into the compiler's `next` branch but not yet on a tagged `cargo-miden` release. The pinned `rust-toolchain.toml` is `nightly-2026-04-30` with the `wasm32-wasip2` target.
:::

## Step 3: Create a Minimal Bank Component

Replace the contents of `contracts/bank-account/src/lib.rs` with a minimal bank structure:

```rust title="contracts/bank-account/src/lib.rs"
// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

/// Storage layout for the bank account component.
///
/// We'll build this up throughout the tutorial. The `#[component_storage]`
/// attribute marks the struct that defines the component's named storage slots.
#[component_storage]
struct BankStorage {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps (depositor AccountId, faucet ID) -> balance (as Felt).
    /// We'll use this to track user balances in Part 1.
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

/// API of the bank account component.
///
/// The `#[component]` trait declares the methods the compiler exports as the
/// component's public WIT interface.
#[component]
trait Bank {
    /// Initialize the bank account, enabling deposits.
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;
}

#[component]
impl Bank for BankStorage {
    fn initialize(&mut self) {
        // Check not already initialized
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        // Set initialized flag to 1
        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt {
        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3], // faucet id prefix
            asset.key[2], // faucet id suffix (folds in the asset metadata byte)
        ]);
        self.balances.get(key)
    }
}
```

This is our starting point with two storage slots:

- `initialized`: A `StorageValue<Word>` slot to track whether the bank is ready
- `balances`: A `StorageMap<Word, Felt>` to track user balances (we'll use this starting in Part 1)

:::note Component Structure
The `#[component_storage]` struct declares the storage layout, the `#[component] trait` declares the exported API, and `#[component] impl Bank for BankStorage` implements it. Any private helper methods you add later live in a separate plain `impl BankStorage` block — the `#[component]` macro only exports trait methods.
:::

:::note get_depositor_balance, not get_balance
The balance accessor is named `get_depositor_balance` rather than `get_balance` so it does not collide with the built-in `ActiveAccount::get_balance` vault method that the account wrapper generates. It also exercises the WIT binding types (`AccountId`, `Asset`), which the compiler needs in at least one exported method.
:::

:::info Contracts Are Excluded
Contracts are excluded from the Cargo workspace and built independently by the Miden toolchain. Each contract carries its own `miden` guest dependency plus a `miden-project.toml`. Only the `integration` crate remains a workspace member.

Because contracts are excluded, your IDE (rust-analyzer) may not provide completions or diagnostics for contract code. This is expected — contracts are built independently using `miden build`.
:::

## Step 4: Build and Verify

Let's verify everything compiles correctly:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build --release
```

<details>
<summary>Expected output</summary>

```text
   Compiling bank-account v0.1.0 (/path/to/miden-bank/contracts/bank-account)
    Finished `release` profile [optimized] target(s)
Creating Miden package /path/to/miden-bank/target/miden/release/bank_account.masp
```

</details>

The compiled output is stored in `target/miden/release/bank_account.masp`.

:::note Cosmetic MAST ERROR lines
On the part2 compiler, every contract build prints one or more non-fatal `MAST`-serialization lines starting with `ERROR`. These are cosmetic — the build still succeeds and produces the `.masp` package. You can ignore them.
:::

:::tip What's a .masp File?
A `.masp` file is a Miden Assembly Package. It contains the compiled MASM (Miden Assembly) code and metadata needed to deploy and interact with your contract.
:::

:::info Build Order Matters
The bank account is the base contract. The deposit/withdraw notes and the init transaction script call into it, and their build relies on the bank account's already-compiled package (the FPI `#[account(...)]` macro reads the bank's procedure roots from its persisted `.masp` at compile time). So always build `bank-account` first, then the notes and transaction script. The integration test harness handles this ordering for you, persisting the bank's `.masp` where dependent contracts look for it.
:::

## Optional: Verify Your Setup

:::note
This is an optional self-check. If you create this test file, you can run it to verify your code compiles and loads correctly. The main runnable tests begin in Part 4.
:::

Create a new test file:

```rust title="integration/tests/part0_setup_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};
use miden_client::account::{
    component::{InitStorageData, StorageValueName},
    StorageSlotName,
};
use miden_client::Word;
use std::{path::Path, sync::Arc};

#[tokio::test]
async fn test_bank_account_builds_and_loads() -> anyhow::Result<()> {
    // Build the bank account contract
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    // The `initialized` value slot has no schema default, so it must be seeded
    // (with a zero Word = uninitialized) or `AccountComponent::from_package`
    // errors with `InitValueNotProvided`. The `balances` map slot defaults to empty.
    let initialized_slot =
        StorageSlotName::new("bank_account::bank::initialized")
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

    let bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg)?;

    // Verify the account was created
    println!("Bank account created with ID: {:?}", bank_account.id());
    println!("Part 0 setup verified!");

    Ok(())
}
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_bank_account_builds_and_loads -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part0_setup_test.rs

running 1 test
Bank account created with ID: 0x...
Part 0 setup verified!
test test_bank_account_builds_and_loads ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

## What We've Built So Far

At this point, you have:

| Component               | Status      | Description                           |
| ----------------------- | ----------- | ------------------------------------- |
| `bank-account`          | Minimal     | Initialization flag + balance storage |
| `deposit-note`          | Not started | Coming in Part 4                      |
| `withdraw-request-note` | Not started | Coming in Part 7                      |
| `init-tx-script`        | Not started | Coming in Part 6                      |

Your bank can be created, but doesn't do anything useful yet. In the next parts, we'll add:

1. **Part 1**: Deeper dive into storage (Value vs StorageMap)
2. **Part 2**: Business rules and constraints
3. **Part 3**: Asset handling for deposits
4. And more...

## Key Takeaways

1. **`miden new`** creates a complete project workspace with contracts and integration folders
2. **Account components** are defined with a `#[component_storage]` struct plus a `#[component]` trait and impl
3. **Storage slots** are declared with `#[storage(description = "...")]` attributes
4. **`miden build`** compiles Rust to Miden Assembly (.masp package)
5. **Tests verify** that your code works before moving on

## Next Steps

Now that your project is set up, let's dive deeper into account components and storage in [Part 1: Account Components and Storage](./account-components).
