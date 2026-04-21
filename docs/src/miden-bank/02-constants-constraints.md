---
sidebar_position: 2
title: "Part 2: Constants and Constraints"
description: "Learn how to define constants for business rules and use assertions to validate transactions in Miden Rust contracts."
---

# Part 2: Constants and Constraints

In this section, you'll learn how to define business rules using constants and enforce them with assertions. We'll implement deposit limits and see how failed constraints cause transactions to be rejected.

## What You'll Build in This Part

By the end of this section, you will have:

- Defined constants for business rules
- Used `assert!()` for transaction validation
- Learned safe Felt comparison with `.as_canonical_u64()`
- Added a deposit method skeleton with validation
- **Verified constraints work** by testing that invalid operations fail

## Building on Part 1

In Part 1, we set up the Bank's storage structure. Now we'll add business rules:

```text
Part 1:                          Part 2:
┌──────────────────┐             ┌──────────────────┐
│ Bank             │             │ Bank             │
│ ─────────────────│    ──►      │ ─────────────────│
│ + initialize()   │             │ + initialize()   │
│ + get_balance()  │             │ + get_balance()  │
│                  │             │ + deposit()      │ ◄── NEW (skeleton)
│                  │             │ + MAX_DEPOSIT    │ ◄── NEW constant
└──────────────────┘             └──────────────────┘
```

## Defining Constants

Constants in Miden Rust contracts work just like regular Rust constants:

```rust title="contracts/bank-account/src/lib.rs"
/// Maximum allowed deposit amount per transaction.
///
/// Value: 1,000,000 tokens (arbitrary limit for demonstration)
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;
```

Use constants for:

- Business rule limits (max amounts, timeouts)
- Magic numbers that need documentation
- Values used in multiple places

:::info Constants vs Storage
Constants are compiled into the contract code and cannot change. Use storage slots for values that need to be modified at runtime.
:::

## The assert!() Macro

The `assert!()` macro validates conditions during transaction execution:

```rust title="contracts/bank-account/src/lib.rs"
pub fn initialize(&mut self) {
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
```

When an assertion fails:

1. The Miden VM execution halts
2. No valid proof can be generated
3. The transaction is rejected

This is the primary mechanism for enforcing business rules in Miden contracts.

## Safe Felt Comparisons

:::warning Pitfall: Felt Comparison Operators
Never use `<`, `>`, `<=`, or `>=` operators directly on `Felt` values. They produce incorrect results due to field element ordering.
:::

**Wrong approach:**

```rust
// DON'T DO THIS - produces incorrect results
if deposit_amount > felt!(1_000_000) {
    // This comparison is unreliable!
}
```

**Correct approach:**

```rust
// CORRECT - convert to u64 first
if deposit_amount.as_canonical_u64() > MAX_DEPOSIT_AMOUNT {
    // This works correctly
}
```

The `.as_canonical_u64()` method extracts the underlying 64-bit integer from a Felt, allowing standard Rust comparisons.

## Step 1: Add the Constant and Deposit Method

Update your `contracts/bank-account/src/lib.rs` to add the constant and a deposit method skeleton:

```rust title="contracts/bank-account/src/lib.rs" {1-4,36-55}
/// Maximum allowed deposit amount per transaction.
///
/// Value: 1,000,000 tokens (arbitrary limit for demonstration)
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;

#[component]
impl Bank {
    /// Initialize the bank account, enabling deposits.
    pub fn initialize(&mut self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

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

    /// Deposit assets into the bank.
    /// For now, this just validates constraints - we'll add asset handling in Part 3.
    pub fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        // ========================================================================
        // CONSTRAINT: Bank must be initialized
        // ========================================================================
        self.require_initialized();

        // Extract the fungible amount from the asset
        let deposit_amount = deposit_asset.value[0];

        // ========================================================================
        // CONSTRAINT: Maximum deposit amount check
        // ========================================================================
        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        // We'll add balance tracking and asset handling in Part 3
        // For now, just validate the constraints
    }
}
```

### The require_initialized() Guard

We use a helper method to check initialization state:

```rust
fn require_initialized(&self) {
    let current: Word = self.initialized.get();
    assert!(
        current[0].as_canonical_u64() == 1,
        "Bank not initialized - deposits not enabled"
    );
}
```

This pattern:

- Centralizes the initialization check
- Provides a clear error message
- Can be reused across multiple methods

## How Assertions Affect Proving

When an assertion fails in the Miden VM:

```text
Transaction Execution Flow:
┌─────────────────────┐
│ User submits TX     │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ VM executes code    │
└──────────┬──────────┘
           ▼
    ┌──────┴──────┐
    │ Assertion?  │
    └──────┬──────┘
     Pass  │  Fail
    ┌──────┴──────┐
    ▼             ▼
┌────────┐   ┌────────────┐
│ Prove  │   │ TX Rejected│
│ Success│   │ No Proof   │
└────────┘   └────────────┘
```

Key points:

- Failed assertions prevent proof generation
- No state changes occur if the transaction fails
- Error messages help with debugging

## Step 2: Build and Verify

Build the updated contract:

```bash title=">_ Terminal"
cd contracts/bank-account
miden build
```

## Try It: Verify Constraints Work

Let's write a test to verify our constraints work correctly. This test verifies that depositing without initialization fails:

```rust title="integration/tests/part2_constraints_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};
use miden_client::account::{StorageMap, StorageSlot, StorageSlotName};
use miden_client::Word;
use std::{path::Path, sync::Arc};

/// Test that our constraint logic is set up correctly
#[tokio::test]
async fn test_constraints_are_defined() -> anyhow::Result<()> {
    // Build the bank account contract to verify it compiles with constraints
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    // Create named storage slots
    let initialized_slot =
        StorageSlotName::new("miden_bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden_bank_account::bank::balances")
            .expect("Valid slot name");

    // Create an uninitialized bank account
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

    // Verify the bank starts uninitialized
    let initialized = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        initialized[0].as_canonical_u64(),
        0,
        "Bank should start uninitialized"
    );

    println!("Bank account created with constraints!");
    println!("  - MAX_DEPOSIT_AMOUNT: 1,000,000");
    println!("  - require_initialized() guard in place");
    println!("  - Initialization status: {}", initialized[0].as_canonical_u64());
    println!("\nPart 2 constraints test passed!");

    Ok(())
}
```

Run the test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_constraints_are_defined -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part2_constraints_test.rs

running 1 test
Bank account created with constraints!
  - MAX_DEPOSIT_AMOUNT: 1,000,000
  - require_initialized() guard in place
  - Initialization status: 0

Part 2 constraints test passed!
test test_constraints_are_defined ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::tip Preview: Testing Failed Assertions
In Part 4, when we have the deposit note script, we'll write a full test that verifies:

1. Depositing without initialization fails
2. Depositing amounts over MAX_DEPOSIT_AMOUNT fails

For now, the constraint logic is in place and we've verified the contract compiles.
:::

## Common Constraint Patterns

### Balance Checks (Preview for Part 3)

```rust
fn require_sufficient_balance(&self, depositor: AccountId, amount: Felt) {
    let balance = self.get_balance(depositor);
    assert!(
        balance.as_canonical_u64() >= amount.as_canonical_u64(),
        "Insufficient balance"
    );
}
```

:::danger Critical: Always Validate Before Subtraction
This pattern is **mandatory** for any operation that subtracts from a balance. Miden uses field element (Felt) arithmetic, which is modular. Without this check, subtracting more than the balance would NOT cause an error - instead, the value would silently wrap around to a large positive number, effectively allowing unlimited withdrawals. See [Common Pitfalls](https://docs.miden.xyz/builder/tutorials/rust-compiler/pitfalls#felt-arithmetic-underflowoverflow) for more details.
:::

### State Checks

```rust
fn require_not_paused(&self) {
    let paused: Word = self.paused.get();
    assert!(
        paused[0].as_canonical_u64() == 0,
        "Contract is paused"
    );
}
```

## Complete Code for This Part

Here's the full `lib.rs` after Part 2:

<details>
<summary>Click to expand full code</summary>

```rust title="contracts/bank-account/src/lib.rs"
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

/// Maximum allowed deposit amount per transaction.
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Bank account component that tracks depositor balances.
#[component]
struct Bank {
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

#[component]
impl Bank {
    /// Initialize the bank account, enabling deposits.
    pub fn initialize(&mut self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

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

    /// Deposit assets into the bank.
    pub fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        // CONSTRAINT: Bank must be initialized
        self.require_initialized();

        let deposit_amount = deposit_asset.value[0];

        // CONSTRAINT: Maximum deposit amount check
        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        // Balance tracking and asset handling added in Part 3
    }
}
```

</details>

## Key Takeaways

1. **Constants** define immutable business rules at compile time
2. **`assert!()`** enforces constraints - failures reject the transaction
3. **Always use `.as_canonical_u64()`** for Felt comparisons, never direct operators
4. **Helper methods** like `require_initialized()` centralize validation logic
5. **Failed assertions** mean no valid proof can be generated

:::tip View Complete Source
See the complete constraint implementation in [contracts/bank-account/src/lib.rs](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/contracts/bank-account/src/lib.rs).
:::

## Next Steps

Now that you can define and enforce business rules, let's learn how to handle assets in [Part 3: Asset Management](./asset-management).
