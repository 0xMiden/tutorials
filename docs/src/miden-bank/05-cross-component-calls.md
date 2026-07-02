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
- Explored the WIT interface files
- **Verified cross-component calls work** via the deposit flow

## Building on Part 4

In Part 4, you wrote `account.deposit(depositor, asset)` in the deposit note. But how does that call actually work? This part explains the binding system:

```text
┌────────────────────────────────────────────────────────────┐
│                  How Bindings Work                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   bank-account/                                            │
│   └── src/lib.rs         miden build                       │
│       fn deposit()      ─────────────▶  generated-wit/     │
│       fn withdraw()                      miden-bank-account.wit
│                                                            │
│                              ┌───────────────────────────┐ │
│                              ▼                           │ │
│   deposit-note/                                          │ │
│   └── src/lib.rs                                         │ │
│       #[account(bank_account::Bank)]                     │ │
│       pub struct Wallet;                                 │ │
│       account.deposit(...)  ────────────▶ calls via binding│
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
│  src/lib.rs      │                   │  miden-bank-account.wit         │
│                  │                   │  (includes world definition)    │
└──────────────────┘                   └─────────────────────────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────────┐
                                       │ deposit-note/                   │
                                       │  imports generated bindings     │
                                       └─────────────────────────────────┘
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
        let assets = active_note::get_assets();

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

Cross-component calls are configured in the note's `miden-project.toml`, which needs **two** dependency entries:

```toml title="contracts/deposit-note/miden-project.toml"
[dependencies]
miden-core = "*"
miden-protocol = "*"
bank-account = { path = "../bank-account" }

# WIT for the account component this note calls, produced by building bank-account.
[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
```

### `[dependencies]` path

```toml
[dependencies]
bank-account = { path = "../bank-account" }
```

This tells `cargo-miden` where to find the source package. Used during the build process to:

- Verify interface compatibility
- Link the compiled MASM code

### `[package.metadata.miden.dependencies]` WIT

```toml
[package.metadata.miden.dependencies]
bank-account = { wit = "../bank-account/target/generated-wit/" }
```

This points at the WIT interface files for the account component this note calls. The path is the `generated-wit/` directory created when you built the account component.

:::warning Both Entries Required
If either entry is missing, your build will fail with linking or interface errors.
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

Only the methods declared on the `#[component] trait Bank` are exported through bindings. The macro exports exactly the trait's methods:

```rust title="contracts/bank-account/src/lib.rs"
/// API of the bank account component.
#[component]
trait Bank {
    // EXPORTED: Available through bindings
    fn initialize(&mut self);
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;
    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset);
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

The WIT files describe the interface. Here's a simplified example:

```wit title="target/generated-wit/miden-bank-account.wit"
interface bank-account {
    use miden:types/types.{account-id, asset, felt, word};

    initialize: func();
    get-depositor-balance: func(depositor: account-id, asset: asset) -> felt;
    deposit: func(depositor: account-id, deposit-asset: asset);
    withdraw: func(withdraw-asset: asset, serial-num: word, tag: felt, note-type: felt);
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

If you completed Part 4 and built both contracts, the bindings are already working! Let's verify:

```bash title=">_ Terminal"
# Check that the WIT files were generated
ls contracts/bank-account/target/generated-wit/
```

<details>
<summary>Expected output</summary>

```text
miden-bank-account.wit
```

</details>

These files enable the deposit note's `#[account(bank_account::Bank)]` wrapper to call `account.deposit()`.

## Common Issues

### "Cannot find module" Error

```
error: cannot find module `bindings`
```

**Cause**: The account component wasn't built, or the WIT path is wrong.

**Solution**:

1. Build the account: `cd contracts/bank-account && miden build`
2. Verify the WIT path in `miden-project.toml` points to `target/generated-wit/`

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

**Solution**: Ensure both `[dependencies]` (`bank-account = { path = "../bank-account" }`) and `[package.metadata.miden.dependencies]` (`bank-account = { wit = "../bank-account/target/generated-wit/" }`) are present with correct paths.

## Key Takeaways

1. **Build accounts first** - They generate WIT files that note scripts need
2. **Two dependency entries** - Both `[dependencies]` (`path`) and `[package.metadata.miden.dependencies]` (`wit`) in `miden-project.toml` are required
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
