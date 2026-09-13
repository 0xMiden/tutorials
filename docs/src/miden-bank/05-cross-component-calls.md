---
sidebar_position: 5
title: "Part 5: Cross-Component Calls"
description: "Learn how note scripts and transaction scripts call account component methods using the #[account(...)] wrapper and proper dependency configuration."
---

# Part 5: Cross-Component Calls

In this section, you'll learn how note scripts call methods on account components. We'll explore the generated bindings system and the dependency configuration that makes the deposit note work.

## What You'll Learn in This Part

By the end of this section, you will have:

- Understood how bindings are generated and imported
- Learned the dependency configuration in `miden-project.toml`
- Explored the embedded WIT interface
- **Verified cross-component calls work** via the deposit flow

## Building on Part 4

In Part 4, you wrote `account.deposit(depositor, asset)` in the deposit note. But how does that call actually work? This part explains the binding system:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                           How Bindings Work                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ bank-account/                                                          │
│ └── src/lib.rs                                                         │
│     #[component] trait Bank                                            │
│     ├── deposit(...)                                                   │
│     └── withdraw(...)                                                  │
│              │                                                         │
│              │ miden build                                             │
│              ▼                                                         │
│    ┌────────────────────────────────────────────────┐                  │
│    │ bank-account.masp                              │                  │
│    │ Compiled code + embedded WIT + procedure roots │                  │
│    └────────────────────────────────────────────────┘                  │
│              │                                                         │
│              │ Read the embedded interface during the note build       │
│              ▼                                                         │
│ deposit-note/                                                          │
│ └── src/lib.rs                                                         │
│     #[account(bank_account::Bank)]                                     │
│     pub struct Wallet;                                                 │
│     account.deposit(...) ──▶ generated binding ──▶ Bank::deposit       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## The Bindings System

When you build an account component with `miden build`, it generates:

1. **MASM code** - The compiled contract logic
2. **Embedded WIT** - WebAssembly Interface Type definitions stored in the package

Other contracts (note scripts, transaction scripts) read the package's embedded interface to call the account's methods.

```text
Build Flow:

┌────────────────────┐                 ┌───────────────────────────────────┐
│ bank-account/      │   miden build   │ bank-account.masp                 │
│   src/lib.rs       │ ──────────────▶ │ Code + embedded WIT               │
│   Bank component   │                 │ Account procedure roots           │
└────────────────────┘                 └───────────────────────────────────┘
                                                         │
                                                         ▼
                                       ┌───────────────────────────────────┐
                                       │ deposit-note/                     │
                                       │ #[account(bank_account::Bank)]    │
                                       │ Generated Wallet bindings         │
                                       │ account.deposit(...)              │
                                       └───────────────────────────────────┘
```

## Declaring the Account Wrapper

In your note script, declare a wrapper struct over the bank account's `Bank` component using the `#[account(...)]` attribute:

```rust title="contracts/deposit-note/src/lib.rs"
use miden::*;

/// Native (active) account of this note: exposes the `bank-account` component's
/// `Bank` methods, gathered from the `bank-account` package's generated WIT.
#[account(bank_account::Bank)]
pub struct Wallet;
```

The `#[account(...)]` path follows this pattern:

```
#[account({package-name}::{trait-name})]
```

For our bank:

- `bank_account` - The package name (derived from `bank-account` with underscores)
- `Bank` - The component trait whose methods are exposed on the wrapper

The macro reads the bank account's generated WIT and generates a `Wallet` type whose methods (`deposit`, `withdraw`, `initialize`, `get_depositor_balance`) call into the bank component across the component boundary.

## Calling Account Methods

The wrapper is passed into the note script as a mutable `account` parameter. Call the account methods directly on it:

```rust title="contracts/deposit-note/src/lib.rs"
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

The binding automatically handles:

- Marshalling arguments across the component boundary
- Invoking the correct MASM procedures
- Returning results back to the caller

## Configuring Dependencies

Cross-component calls are configured in the note's `miden-project.toml`, which declares the bank as a path dependency:

```toml title="contracts/deposit-note/miden-project.toml"
[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

```

### `[dependencies]` path

```toml
[dependencies]
bank-account = { path = "../bank-account" }
```

This tells `cargo-miden` where to find the source package. Used during the build process to:

- Verify interface compatibility
- Link the compiled MASM code

### Embedded Interface

Compiler 0.10 embeds the WIT interface in the compiled bank package. The path dependency provides both the interface and the procedure roots. Remove the legacy `[package.metadata.miden.dependencies]` `wit` override: supplying it alongside an embedded interface causes the compiler to reject the build.

## Build Order

From the project root, build the account first to inspect its output, then build the note:

```bash title=">_ Terminal"
# 1. Build the account component first
cd contracts/bank-account
miden build

# 2. Then build note scripts that depend on it
cd ../deposit-note
miden build

# 3. Return to the project root
cd ../..
```

If you build a dependent contract directly, compiler 0.10 also builds its path dependencies.

## What Methods Are Available?

Only the methods declared on the `#[component] trait Bank` are exported through bindings. The macro exports exactly the trait's methods:

```rust title="contracts/bank-account/src/lib.rs"
/// API of the bank account component.
#[component]
trait Bank {
    // EXPORTED: Available through bindings
    #[account_procedure]
    fn initialize(&mut self);
    #[account_procedure]
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;
    #[account_procedure]
    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset);
    #[account_procedure]
    fn withdraw(&mut self, withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);
}
```

Private helpers stay off the trait. They live in a separate plain `impl BankStorage` block, so they are **not** exposed through bindings:

```rust title="contracts/bank-account/src/lib.rs"
/// Internal helpers that are not part of the component's exported WIT API.
impl BankStorage {
    fn balance_key(depositor: AccountId, asset: &Asset) -> Word { ... }
    fn require_initialized(&self) { ... }
    fn create_p2id_note(&mut self, /* ... */) { ... }
}
```

:::note `get_depositor_balance`, not `get_balance`
The balance getter is named `get_depositor_balance` to avoid colliding with the built-in `ActiveAccount::get_balance` vault method that the account wrapper generates.
:::

## Understanding the Generated WIT

The compiler embeds this WIT in the bank package. Its imported core types come from the SDK:

```wit title="Embedded bank interface"
package miden:bank-account@0.1.0;

use miden:base/core-types@1.0.0;

interface bank {
    use core-types.{account-id, asset, felt, word};

    initialize: func();
    get-depositor-balance: func(depositor: account-id, asset: asset) -> felt;
    deposit: func(depositor: account-id, deposit-asset: asset);
    withdraw: func(withdraw-asset: asset, serial-num: word, tag: felt, note-type: felt);
}

world bank-world {
    export bank;
}
```

This WIT is what the `#[account(bank_account::Bank)]` macro reads to generate the `Wallet` wrapper's methods.

## Transaction Script Bindings (Preview)

Transaction scripts use the same `#[account(...)]` wrapper as note scripts. The wrapper is passed in as the `account` parameter:

```rust title="contracts/init-tx-script/src/lib.rs"
use miden::*;

/// Native (active) account this tx-script runs against: the bank-account `Bank` component.
#[account(bank_account::Bank)]
pub struct Wallet;

#[tx_script]
fn run(_arg: Word, account: &mut Wallet) {
    account.initialize();
}
```

The `Wallet` wrapper gives direct method access through the `account` parameter, exactly like the note scripts above. We'll implement this in Part 6.

## Try It: Verify Bindings Work

After running the builds above, check the bank package from the project root:

```bash title=">_ Terminal"
# Check the compiled package (its interface is embedded)
ls contracts/bank-account/target/miden/dev/bank-account.masp
```

<details>
<summary>Expected output</summary>

```text
contracts/bank-account/target/miden/dev/bank-account.masp
```

</details>

The embedded interface enables the deposit note's `#[account(bank_account::Bank)]` wrapper to call `account.deposit()`.

## Common Issues

### "Cannot find module" Error

```
error: cannot find module `bindings`
```

**Cause**: The account path dependency is missing or points to the wrong project.

**Solution**:

1. Build the account: `cd contracts/bank-account && miden build`
2. Verify the `bank-account` path dependency in `miden-project.toml` points to the account project; remove legacy `wit` overrides

### "Method not found" Error

```
error: no method named `deposit` found
```

**Cause**: The method isn't declared on the `#[component] trait Bank`. Only trait methods are exported through bindings.

**Solution**: Ensure the method is declared on the `trait Bank`, not just on the private `impl BankStorage` helpers block.

### "Dependency not found" Error

```
error: dependency 'bank-account' not found
```

**Cause**: One of the dependency entries in `miden-project.toml` is missing or has the wrong path.

**Solution**: Add `bank-account = { path = "../bank-account" }` under `[dependencies]` and remove the legacy `wit` override.

## Key Takeaways

1. **Declare the path dependency** - The compiler builds the account package and reads its embedded WIT
2. **Embedded interface** - Declare the path under `[dependencies]`; compiler 0.10 reads the interface from the compiled dependency. Do not add the legacy `wit` override.
3. **Account wrapper pattern** - `#[account(bank_account::Bank)] pub struct Wallet;` exposes the component's methods on the `account` parameter
4. **Only trait methods** - Methods on the private `impl BankStorage` helpers aren't exposed in bindings
5. **Note and tx scripts share the pattern** - Both receive the account wrapper as a parameter (Part 6)

:::tip View Complete Source
See the complete `miden-project.toml` configurations:

- [Deposit Note miden-project.toml](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/deposit-note/miden-project.toml)
- [Withdraw Request Note miden-project.toml](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/withdraw-request-note/miden-project.toml)
  :::

## Next Steps

Now that you understand cross-component calls, let's create the transaction script that initializes the bank in [Part 6: Transaction Scripts](./transaction-scripts).
