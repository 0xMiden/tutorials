---
sidebar_position: 1
title: "Part 1: Account Components and Storage"
description: "Learn how to define account components with the #[component] attribute and manage persistent state using Value and StorageMap storage types."
---

# Part 1: Account Components and Storage

In this section, you'll learn the fundamentals of building Miden account components. We'll explore the storage types introduced in Part 0 — `StorageValue` and `StorageMap` — and add component methods.

## What You'll Build in This Part

By the end of this section, you will have:

- Understood the `#[component]` attribute and what it generates
- Explored how `StorageMap` works for tracking depositor balances
- Implemented a `get_depositor_balance()` query method
- **Verified it works** with an integration test

## Building on Part 0

In Part 0, we created the Bank struct with `initialized` and `balances` storage. Now we'll explore the storage types in detail and add methods:

```text
Part 0:                                       Part 1:
┌──────────────────────────────────┐         ┌──────────────────────────────────┐
│ Bank                             │         │ Bank                             │
│ ──────────────────────────────── │   ──►   │ ──────────────────────────────── │
│ initialized (StorageValue<Word>) │         │ initialized (StorageValue<Word>) │
│ balances (StorageMap<Word, Felt>)│         │ balances (StorageMap<Word, Felt>)│
└──────────────────────────────────┘         │ + initialize()                   │
                                             │ + get_depositor_balance()        │ ◄── NEW
                                             │ + require_initialized()          │
                                             └──────────────────────────────────┘
```

## The #[component] Attributes

A bank component is described with three attributes that work together:

- **`#[component_storage]`** marks the struct that declares the persistent storage fields
- **`#[component]`** on a `trait` declares the component's exported API
- **`#[component]`** on the `impl Trait for Storage` block implements that API

When you compile with `miden build`, the macros generate:

- **WIT (WebAssembly Interface Types)** bindings for cross-component calls
- **MASM (Miden Assembly)** code for the account logic
- **Storage slot management** code

Only the methods declared in the `#[component]` trait are exported. Private helpers live in a separate plain `impl BankStorage` block (covered later in this tutorial).

Let's expand our Bank component:

## Step 1: Understand the Storage Layout

In Part 0, we created the Bank struct with two storage fields. Let's examine what they do. The storage struct is marked with `#[component_storage]`. Here is `contracts/bank-account/src/lib.rs`:

```rust title="contracts/bank-account/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

use miden::Felt;

/// Storage layout for the bank account component.
#[component_storage]
struct BankStorage {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps (depositor AccountId, faucet ID) -> balance (as Felt).
    /// Key: [depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}
```

The `balances` field is a `StorageMap` that tracks each depositor's balance. The compiler derives slot IDs by hashing slot names (not by field declaration order). Slot names follow the pattern `{package_name}::{component_interface}::{field_name}` — here `bank_account::bank::initialized` and `bank_account::bank::balances`.

## Storage Types Explained

Miden accounts have persistent storage slots. Public account storage is published on-chain; private accounts publish its commitment. A value slot holds one `Word` (4 Felts = 32 bytes), while a map slot holds the root of its key-value map. The Miden Rust compiler provides two abstractions:

### StorageValue Storage

The `StorageValue<Word>` type provides access to a single storage slot:

```rust
#[storage(description = "initialized")]
initialized: StorageValue<Word>,
```

Use `StorageValue<Word>` when you need to store a single `Word` of data.

**Reading and writing:**

```rust
// Get returns a Word
let current: Word = self.initialized.get();

// Check the first element (our flag)
if current[0].as_canonical_u64() == 0 {
    // Not initialized
}

// Set a new value
let new_value = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
self.initialized.set(new_value);
```

:::tip Type Annotations
`StorageValue<Word>::get()` returns a `Word`. The annotation in `let current: Word = self.initialized.get();` makes that type explicit but is not required.
:::

### StorageMap

The `StorageMap<Word, Felt>` type provides key-value storage within a slot:

```rust
#[storage(description = "balances")]
balances: StorageMap<Word, Felt>,
```

Use `StorageMap` when you need to store multiple values indexed by keys.

**Reading and writing:**

```rust
// Create a key (must be a Word).
// The bank keys balances per (depositor, faucet): asset.key[3] is the faucet
// id prefix and asset.key[2] is the faucet id suffix (plus a metadata byte).
let key = Word::from([
    depositor.prefix,
    depositor.suffix,
    asset.key[3],
    asset.key[2],
]);

// This field is StorageMap<Word, Felt>, so get returns Felt.
let balance: Felt = self.balances.get(key);

// Set stores a Felt at this Word key.
let new_balance = Felt::new(balance.as_canonical_u64() + deposit_amount.as_canonical_u64()).unwrap();
self.balances.set(key, new_balance);
```

:::info StorageMap Has a Generic API
`StorageMap<K, V>::get()` returns the map's declared value type `V`, which must implement `WordValue`. Our `StorageMap<Word, Felt>` therefore returns `Felt`; the variable annotation does not change the map's value type. A map declared with `Word` values would return `Word`.
:::

### Storage Layout

Plan your storage layout carefully:

| Name          | Type                     | Purpose             |
| ------------- | ------------------------ | ------------------- |
| `initialized` | `StorageValue<Word>`     | Initialization flag |
| `balances`    | `StorageMap<Word, Felt>` | Depositor balances  |

The `description` attribute adds human-readable metadata. The package namespace, component interface, and field name determine slot names such as `bank_account::bank::initialized`, which tests use to identify slots. The naming convention is `{package_name}::{component_interface}::{field_name}`. The compiler derives slot IDs by hashing these names, so field declaration order does not affect slot assignment.

## Step 2: Implement Component Methods

Now let's add methods to our Bank. The exported API is declared as a `#[component]` trait, and the `#[component]` attribute is used again on the `impl Bank for BankStorage` block that implements it:

```rust title="contracts/bank-account/src/lib.rs"
/// API of the bank account component.
#[component]
trait Bank {
    /// Initialize the bank account, enabling deposits.
    #[account_procedure]
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    #[account_procedure]
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
        self.balances.get(BankStorage::balance_key(depositor, &asset))
    }
}
```

Note the method is named `get_depositor_balance`, not `get_balance`: the account wrapper generates a built-in `ActiveAccount::get_balance` vault method, so reusing that name would collide with it.

The private helpers (`balance_key`, `require_initialized`, …) are not part of the exported API, so they live in a separate plain `impl BankStorage` block — the `#[component]` macro only exports the trait methods:

```rust title="contracts/bank-account/src/lib.rs"
/// Internal helpers that are not part of the component's exported WIT API.
impl BankStorage {
    /// Derive the `balances` map key identifying a (depositor, faucet) pair:
    /// `[depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]`.
    fn balance_key(depositor: AccountId, asset: &Asset) -> Word {
        Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3],
            asset.key[2],
        ])
    }

    /// Check that the bank is initialized.
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }
}
```

:::info v0.16 fungible-asset ID layout
A fungible asset's ID Word is `[asset_class_suffix, asset_class_prefix, faucet_suffix | metadata_byte, faucet_prefix]`. For fungible assets, the asset class is empty. `asset.key[3]` is the faucet ID prefix and `asset.key[2]` is the faucet ID suffix with the composition bits in its low byte, so `key[2]` is **not** the raw faucet suffix. The callback flag is now encoded in the faucet account ID, not in the asset metadata byte. The host-side mirror is `FungibleAsset::to_id_word()` indices `[3]`/`[2]`.
:::

The bank requires initialization before accepting deposits: `require_initialized()` is called at the top of `deposit()` and `withdraw()` (covered in later parts).

### Exported vs Internal Methods

- **Trait methods** (declared in the `#[component] trait`) are exposed in the generated WIT interface and can be called by other contracts
- **Inherent helpers** (in the plain `impl BankStorage`) are internal and cannot be called from the outside

```rust
// Exported: Can be called by note scripts and other contracts
fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt { ... }

// Internal helper, not exposed
fn require_initialized(&self) { ... }
```

## Step 3: Build the Component

Build your updated account component:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

This compiles the Rust code to Miden Assembly and generates:

- `target/miden/dev/bank-account.masp` - The compiled package
- The package embeds the WIT interface used by dependent contracts

## Optional: Verify Your Code

:::note
This is an optional self-check. If you create this test file, you can run it to verify your component. The main runnable tests begin in Part 4.
:::

This test will:

1. Create a bank account
2. Initialize it
3. Verify the storage was updated

Create a new test file:

```rust title="integration/tests/part1_account_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};
use miden_client::account::{component::{InitStorageData, StorageValueName}, StorageSlotName};
use miden_client::{Felt, Word};
use std::{path::Path, sync::Arc};

#[tokio::test]
async fn test_bank_account_storage() -> anyhow::Result<()> {
    // =========================================================================
    // SETUP: Build contracts and create the bank account
    // =========================================================================

    // Build the bank account contract
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    // Create named storage slots matching the contract's storage layout
    // The naming convention is: {package_name}::{component_interface}::{field_name}
    let initialized_slot =
        StorageSlotName::new("bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("bank_account::bank::balances")
            .expect("Valid slot name");

    // The `initialized` value slot has no schema default, so it MUST be seeded
    // here — otherwise AccountComponent::from_package fails with InitValueNotProvided.
    // Only the `balances` map defaults to empty.
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

    // =========================================================================
    // VERIFY: Check initial storage state
    // =========================================================================

    // Verify initialized flag starts as 0
    let initialized_value = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        initialized_value,
        Word::default(),
        "Initialized flag should start as 0"
    );

    println!("Bank account created successfully!");
    println!("  Account ID: {:?}", bank_account.id());
    println!("  Initialized flag: {:?}", initialized_value[0].as_canonical_u64());

    // =========================================================================
    // VERIFY: Storage slots are correctly configured
    // =========================================================================

    // Check that we can query the balances map (should return 0 for any key)
    let test_key = Word::from([Felt::from(1u32), Felt::from(2u32), Felt::from(0u32), Felt::from(0u32)]);
    let balance = bank_account.storage().get_map_item(
        &balances_slot,
        miden_client::account::StorageMapKey::new(test_key),
    )?;

    // Balance for non-existent depositor should be all zeros
    assert_eq!(
        balance,
        Word::default(),
        "Balance for unknown depositor should be zero"
    );

    println!("  Balances map accessible: Yes");
    println!("\nPart 1 test passed!");

    Ok(())
}
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_bank_account_storage -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part1_account_test.rs

running 1 test
Bank account created successfully!
  Account ID: 0x...
  Initialized flag: 0
  Balances map accessible: Yes

Part 1 test passed!
test test_bank_account_storage ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::tip Troubleshooting
**"cannot find function `build_project_in_dir`"**: Make sure your `integration/src/helpers.rs` exports this function and `integration/src/lib.rs` has `pub mod helpers;`.

**"StorageSlot not found"**: Ensure you're using the correct imports: `use miden_client::account::{StorageSlot, StorageSlotName};`
:::

## Complete Code for This Part

Here's the full `lib.rs` after Part 1:

<details>
<summary>Click to expand full code</summary>

```rust title="contracts/bank-account/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

use miden::Felt;

/// Storage layout for the bank account component.
#[component_storage]
struct BankStorage {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps (depositor AccountId, faucet ID) -> balance (as Felt).
    /// Key: [depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

/// API of the bank account component.
#[component]
trait Bank {
    /// Initialize the bank account, enabling deposits.
    #[account_procedure]
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    #[account_procedure]
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
        self.balances.get(BankStorage::balance_key(depositor, &asset))
    }
}

/// Internal helpers that are not part of the component's exported WIT API.
///
/// The `#[component]` macro exports only the methods of the `Bank` trait, so these
/// inherent methods stay private to the contract.
impl BankStorage {
    /// Derive the `balances` map key identifying a (depositor, faucet) pair:
    /// `[depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]`.
    fn balance_key(depositor: AccountId, asset: &Asset) -> Word {
        Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3],
            asset.key[2],
        ])
    }

    /// Check that the bank is initialized.
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }
}
```

</details>

## Key Takeaways

1. **`#[component]`** marks the exported component trait and its implementation; `#[component_storage]` marks the storage struct
2. **`StorageValue<Word>`** stores a single Word, read with `.get()`, write with `.set()`
3. **`StorageMap<Word, Felt>`** stores key-value pairs, access with `.get()` and `.set()`
4. **Storage slots** are identified by name (IDs derived from hashed slot names), each holds 4 Felts (32 bytes)
5. **Trait methods** (declared in the `#[component] trait`) are callable by other contracts via generated bindings; private helpers live in a plain `impl` block

:::tip View Complete Source
See the complete bank account implementation in [contracts/bank-account/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/bank-account/src/lib.rs).
:::

## Next Steps

Now that you understand account components and storage, let's learn how to define business rules with [Part 2: Constants and Constraints](./constants-constraints).
