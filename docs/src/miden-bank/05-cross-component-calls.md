---
sidebar_position: 5
title: "Part 5: Cross-Component Calls"
description: "Learn how note scripts and transaction scripts call account component methods using generated bindings and proper dependency configuration."
---

# Part 5: Cross-Component Calls

In this section, you'll learn how note scripts call methods on account components. We'll explore the generated bindings system and the dependency configuration that makes the deposit note work.

## What You'll Learn in This Part

By the end of this section, you will have:

- Understood how bindings are generated and imported
- Learned the dependency configuration in `Cargo.toml`
- Explored the WIT interface files
- **Verified cross-component calls work** via the deposit flow

## Building on Part 4

In Part 4, you wrote `bank_account::deposit(depositor, asset)` in the deposit note. But how does that call actually work? This part explains the binding system:

```text
┌────────────────────────────────────────────────────────────┐
│                  How Bindings Work                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   bank-account/                                            │
│   └── src/lib.rs         miden build                       │
│       pub fn deposit()  ─────────────▶  generated-wit/     │
│       pub fn withdraw()                  miden_bank-account.wit
│                                                            │
│                              ┌───────────────────────────┐ │
│                              ▼                           │ │
│   deposit-note/                                          │ │
│   └── src/lib.rs                                         │ │
│       use crate::bindings::miden::bank_account::bank_account;
│       bank_account::deposit(...) ◄───── calls via binding │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## The Bindings System

When you build an account component with `miden build`, it generates:

1. **MASM code** - The compiled contract logic
2. **WIT files** - WebAssembly Interface Type definitions

Other contracts (note scripts, transaction scripts) import these WIT files to call the account's methods.

```text
Build Flow:
┌──────────────────┐    miden build    ┌─────────────────────────────────┐
│ bank-account/    │ ─────────────────▶│ target/generated-wit/           │
│  src/lib.rs      │                   │  miden_bank-account.wit         │
│                  │                   │  miden_bank-account_world.wit   │
└──────────────────┘                   └─────────────────────────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────────┐
                                       │ deposit-note/                   │
                                       │  imports generated bindings     │
                                       └─────────────────────────────────┘
```

## Importing Bindings

In your note script, import the generated bindings:

```rust title="contracts/deposit-note/src/lib.rs"
// Import the bank account's generated bindings
use crate::bindings::miden::bank_account::bank_account;
```

The import path follows this pattern:

```
crate::bindings::{package-prefix}::{component-name}::{interface-name}
```

For our bank:

- `miden` - The package prefix from `[package.metadata.component]`
- `bank_account` - The component name (derived from package name with underscores)
- `bank_account` - The interface name (same as component)

## Calling Account Methods

Once imported, call the account methods directly:

```rust title="contracts/deposit-note/src/lib.rs"
#[note]
struct DepositNote;

#[note]
impl DepositNote {
    #[note_script]
    fn run(self, _arg: Word) {
        let depositor = active_note::get_sender();
        let assets = active_note::get_assets();

        for asset in assets {
            // Call the bank account's deposit method
            bank_account::deposit(depositor, asset);
        }
    }
}
```

The binding automatically handles:

- Marshalling arguments across the component boundary
- Invoking the correct MASM procedures
- Returning results back to the caller

## Configuring Dependencies

Your `Cargo.toml` needs **two** dependency sections:

```toml title="contracts/deposit-note/Cargo.toml"
[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }

[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

### miden.dependencies

```toml
[package.metadata.miden.dependencies]
"miden:bank-account" = { path = "../bank-account" }
```

This tells `cargo-miden` where to find the source package. Used during the build process to:

- Verify interface compatibility
- Link the compiled MASM code

### component.target.dependencies

```toml
[package.metadata.component.target.dependencies]
"miden:bank-account" = { path = "../bank-account/target/generated-wit/" }
```

This tells the Rust compiler where to find the WIT interface files. The path points to the `generated-wit/` directory created when you built the account component.

:::warning Both Sections Required
If either section is missing, your build will fail with linking or interface errors.
:::

## Build Order

Components must be built in dependency order:

```bash title=">_ Terminal"
# 1. Build the account component first
cd contracts/bank-account
miden build

# 2. Then build note scripts that depend on it
cd ../deposit-note
miden build
```

If you build out of order, you'll see errors about missing WIT files.

## What Methods Are Available?

Only **public methods** (`pub fn`) on the `#[component] impl` block are available through bindings:

```rust title="contracts/bank-account/src/lib.rs"
#[component]
impl Bank {
    // PUBLIC: Available through bindings
    pub fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) { ... }
    pub fn withdraw(&mut self, /* ... */) { ... }
    pub fn get_balance(&self, depositor: AccountId) -> Felt { ... }
    pub fn initialize(&mut self) { ... }

    // PRIVATE: NOT available through bindings
    fn require_initialized(&self) { ... }
    fn create_p2id_note(&mut self, /* ... */) { ... }
}
```

## Understanding the Generated WIT

The WIT files describe the interface. Here's a simplified example:

```wit title="target/generated-wit/miden_bank-account.wit"
interface bank-account {
    use miden:types/types.{account-id, asset, felt, word};

    initialize: func();
    deposit: func(depositor: account-id, deposit-asset: asset);
    withdraw: func(depositor: account-id, withdraw-asset: asset, ...);
    get-balance: func(depositor: account-id) -> felt;
}
```

This WIT is used to generate the Rust bindings that appear in `crate::bindings`.

## Transaction Script Bindings (Preview)

Transaction scripts use a slightly different import pattern:

```rust title="contracts/init-tx-script/src/lib.rs"
use crate::bindings::Account;

#[tx_script]
fn run(_arg: Word, account: &mut Account) {
    // The account parameter IS the bound component
    account.initialize();
}
```

The `Account` binding in transaction scripts wraps the entire component, giving direct method access through the `account` parameter. We'll implement this in Part 6.

## Try It: Verify Bindings Work

If you completed Part 4 and built both contracts, the bindings are already working! Let's verify:

```bash title=">_ Terminal"
# Check that the WIT files were generated
ls contracts/bank-account/target/generated-wit/
```

<details>
<summary>Expected output</summary>

```text
miden_bank-account.wit
miden_bank-account_world.wit
```

</details>

These files enable the deposit note to call `bank_account::deposit()`.

## Common Issues

### "Cannot find module" Error

```
error: cannot find module `bindings`
```

**Cause**: The account component wasn't built, or the WIT path is wrong.

**Solution**:

1. Build the account: `cd contracts/bank-account && miden build`
2. Verify the WIT path in `Cargo.toml` points to `target/generated-wit/`

### "Method not found" Error

```
error: no method named `deposit` found
```

**Cause**: The method isn't marked `pub` in the account component.

**Solution**: Ensure the method has `pub fn` visibility.

### "Dependency not found" Error

```
error: dependency 'miden:bank-account' not found
```

**Cause**: One of the dependency sections is missing or has the wrong path.

**Solution**: Ensure both `[package.metadata.miden.dependencies]` and `[package.metadata.component.target.dependencies]` are present with correct paths.

## Key Takeaways

1. **Build accounts first** - They generate WIT files that note scripts need
2. **Two dependency sections** - Both `miden.dependencies` and `component.target.dependencies` are required
3. **Import path pattern** - `crate::bindings::{package}::{component}::{interface}`
4. **Only public methods** - Private methods aren't exposed in bindings
5. **Transaction scripts differ** - They receive the account as a parameter (Part 6)

:::tip View Complete Source
See the complete Cargo.toml configurations:

- [Deposit Note Cargo.toml](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/deposit-note/Cargo.toml)
- [Withdraw Request Note Cargo.toml](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/withdraw-request-note/Cargo.toml)
  :::

## Next Steps

Now that you understand cross-component calls, let's create the transaction script that initializes the bank in [Part 6: Transaction Scripts](./transaction-scripts).
