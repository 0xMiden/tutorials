---
sidebar_position: 1
title: "Part 1: Account Components and Storage"
description: "Learn how to define account components with the #[component] attribute and manage persistent state using Value and StorageMap storage types."
---

# Part 1: Account Components and Storage

In this section, you'll learn the fundamentals of building Miden account components. We'll expand our Bank to include balance tracking with a `StorageMap`, giving us the foundation for deposits and withdrawals.

## What You'll Build in This Part

By the end of this section, you will have:

- Understood the `#[component]` attribute and what it generates
- Added a `StorageMap` for tracking depositor balances
- Implemented a `get_balance()` query method
- **Verified it works** with a MockChain test

## Building on Part 0

In Part 0, we created a minimal bank with just an `initialized` flag. Now we'll add balance tracking:

```text
Part 0:                                   Part 1:
┌──────────────────────────────┐             ┌──────────────────────────────────┐
│ Bank                         │             │ Bank                             │
│ ────────────────────────     │    ──►      │ ────────────────────────────     │
│ initialized (StorageValue)   │             │ initialized (StorageValue<Word>) │
│                              │             │ balances (StorageMap<Word, Felt>)│ ◄── NEW
└──────────────────────────────┘             └──────────────────────────────────┘
```

## The #[component] Attribute

The `#[component]` attribute marks a struct as a Miden account component. When you compile with `miden build`, it generates:

- **WIT (WebAssembly Interface Types)** bindings for cross-component calls
- **MASM (Miden Assembly)** code for the account logic
- **Storage slot management** code

Let's expand our Bank component:

## Step 1: Add the Balances Storage Map

Update `contracts/bank-account/src/lib.rs`:

```rust title="contracts/bank-account/src/lib.rs" {17-20}
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

/// Bank account component that tracks depositor balances.
#[component]
struct Bank {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps depositor AccountId -> balance (as Felt)
    /// Key: [prefix, suffix, asset_prefix, asset_suffix]
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}
```

We've added a `StorageMap` that will track each depositor's balance. The compiler auto-assigns slot numbers based on field order.

## Storage Types Explained

Miden accounts have storage slots that persist state on-chain. Each slot holds one `Word` (4 Felts = 32 bytes). The Miden Rust compiler provides two abstractions:

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
The `.get()` method requires a type annotation: `let current: Word = self.initialized.get();`
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
// Create a key (must be a Word)
let key = Word::from([
    depositor.prefix,
    depositor.suffix,
    felt!(0),
    felt!(0),
]);

// Get returns a Felt (single value, not a Word)
let balance: Felt = self.balances.get(&key);

// Set stores a Felt at the key
let new_balance = balance + deposit_amount;
self.balances.set(key, new_balance);
```

:::warning StorageMap Returns Felt
Unlike `Value::read()` which returns a `Word`, `StorageMap::get()` returns a single `Felt`. This is an important distinction.
:::

### Storage Layout

Plan your storage layout carefully:

| Name          | Type                     | Purpose             |
| ------------- | ------------------------ | ------------------- |
| `initialized` | `StorageValue<Word>`     | Initialization flag |
| `balances`    | `StorageMap<Word, Felt>` | Depositor balances  |

The `description` attribute generates named slot identifiers (e.g., `miden_bank_account::bank::initialized`) used in tests to reference specific slots. The naming convention is `{package_name}::{component_struct}::{field_name}`. The compiler auto-assigns slot numbers based on field order.

## Step 2: Implement Component Methods

Now let's add methods to our Bank. The `#[component]` attribute is also used on the `impl` block:

```rust title="contracts/bank-account/src/lib.rs"
#[component]
impl Bank {
    /// Initialize the bank account, enabling deposits.
    pub fn initialize(&mut self) {
        // Get current value from storage
        let current: Word = self.initialized.get();

        // Check not already initialized
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        // Set initialized flag to 1
        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    /// Get the balance for a depositor.
    pub fn get_balance(&self, depositor: AccountId) -> Felt {
        let key = Word::from([depositor.prefix, depositor.suffix, felt!(0), felt!(0)]);
        self.balances.get(key)
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

### Public vs Private Methods

- **Public methods** (`pub fn`) are exposed in the generated WIT interface and can be called by other contracts
- **Private methods** (`fn`) are internal and cannot be called from outside

```rust
// Public: Can be called by note scripts and other contracts
pub fn get_balance(&self, depositor: AccountId) -> Felt { ... }

// Private: Internal helper, not exposed
fn require_initialized(&self) { ... }
```

## Step 3: Build the Component

Build your updated account component:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

This compiles the Rust code to Miden Assembly and generates:

- `target/miden/release/bank_account.masp` - The compiled package
- `target/generated-wit/` - WIT interface files for other contracts to use

## Try It: Verify Your Code

Let's write a MockChain test to verify our Bank component works correctly. This test will:

1. Create a bank account
2. Initialize it
3. Verify the storage was updated

Create a new test file:

```rust title="integration/tests/part1_account_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};
use miden_client::account::{StorageMap, StorageSlot, StorageSlotName};
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
    // The naming convention is: {package_name}::{component_struct}::{field_name}
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
    let test_key = Word::from([Felt::new(1), Felt::new(2), Felt::new(0), Felt::new(0)]);
    let balance = bank_account.storage().get_map_item(&balances_slot, test_key)?;

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

/// Bank account component that tracks depositor balances.
#[component]
struct Bank {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps depositor AccountId -> balance (as Felt)
    /// Key: [prefix, suffix, asset_prefix, asset_suffix]
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

#[component]
impl Bank {
    /// Initialize the bank account, enabling deposits.
    pub fn initialize(&mut self) {
        // Get current value from storage
        let current: Word = self.initialized.get();

        // Check not already initialized
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        // Set initialized flag to 1
        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    /// Get the balance for a depositor.
    pub fn get_balance(&self, depositor: AccountId) -> Felt {
        let key = Word::from([depositor.prefix, depositor.suffix, felt!(0), felt!(0)]);
        self.balances.get(key)
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

1. **`#[component]`** marks structs and impl blocks as Miden account components
2. **`StorageValue<Word>`** stores a single Word, read with `.get()`, write with `.set()`
3. **`StorageMap<Word, Felt>`** stores key-value pairs, access with `.get()` and `.set()`
4. **Storage slots** are identified by name (auto-assigned by compiler), each holds 4 Felts (32 bytes)
5. **Public methods** are callable by other contracts via generated bindings

:::tip View Complete Source
See the complete bank account implementation in [contracts/bank-account/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/bank-account/src/lib.rs).
:::

## Next Steps

Now that you understand account components and storage, let's learn how to define business rules with [Part 2: Constants and Constraints](./constants-constraints).
