---
sidebar_position: 8
title: "Part 8: Complete Flows"
description: "Walk through end-to-end deposit and withdrawal flows, understanding how all the pieces work together in the banking application."
---

# Part 8: Complete Flows

In this final section, we'll bring everything together and walk through the complete deposit and withdrawal flows, verifying that all the components work as a unified banking system.

## What You'll Build in This Part

By the end of this section, you will have:

- Understood the complete deposit flow from note creation to balance update
- Understood the complete withdraw flow including P2ID note creation
- **Verified the entire system works** with an end-to-end MockChain test
- Completed the Miden Bank tutorial! 🎉

## Building on Parts 0-7

You've built all the pieces. Now let's see them work together:

```text
┌────────────────────────────────────────────────────────────────┐
│                 COMPLETE BANK SYSTEM                           │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Components Built:                                             │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ bank-account    │ Storage + deposit() + withdraw()       │  │
│   ├─────────────────┼───────────────────────────────────────┤  │
│   │ deposit-note    │ Note script → bank_account::deposit()  │  │
│   ├─────────────────┼───────────────────────────────────────┤  │
│   │ withdraw-note   │ Note script → bank_account::withdraw() │  │
│   ├─────────────────┼───────────────────────────────────────┤  │
│   │ init-tx-script  │ Transaction script → initialize()      │  │
│   └─────────────────┴───────────────────────────────────────┘  │
│                                                                 │
│   Storage Layout:                                               │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ initialized (Value)      │ Word: [1, 0, 0, 0] when ready│  │
│   │ balances (StorageMap)    │ Map: user_key → [balance, 0, 0, 0]│  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## The Complete Deposit Flow

Let's trace through exactly what happens when a user deposits tokens:

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        DEPOSIT FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. USER CREATES DEPOSIT NOTE                                        │
│     ┌──────────────────────┐                                        │
│     │ Deposit Note         │                                        │
│     │  sender: User        │                                        │
│     │  assets: [1000 tok]  │                                        │
│     │  script: deposit-note│                                        │
│     │  target: Bank        │                                        │
│     └──────────────────────┘                                        │
│              │                                                       │
│              ▼                                                       │
│  2. BANK CONSUMES NOTE (Transaction begins)                         │
│     ┌──────────────────────┐                                        │
│     │ Bank Account         │                                        │
│     │  vault += 1000 tokens│  ◀── Protocol adds assets to vault    │
│     └──────────────────────┘                                        │
│              │                                                       │
│              ▼                                                       │
│  3. NOTE SCRIPT EXECUTES                                            │
│     depositor = active_note::get_sender() → User's AccountId        │
│     assets = active_note::get_assets()    → [1000 tokens]           │
│     for asset in assets:                                            │
│         bank_account::deposit(depositor, asset)  ◀── Cross-component│
│              │                                                       │
│              ▼                                                       │
│  4. DEPOSIT METHOD RUNS (in bank-account context)                   │
│     ┌──────────────────────────────────────────┐                    │
│     │ require_initialized()     ✓ Passes       │                    │
│     │ amount <= MAX_DEPOSIT     ✓ 1000 <= 100k │                    │
│     │ native_account::add_asset() ← Confirm    │                    │
│     │ balances[User] += 1000    ← Update       │                    │
│     └──────────────────────────────────────────┘                    │
│              │                                                       │
│              ▼                                                       │
│  5. TRANSACTION COMPLETES                                           │
│     Bank storage: balances[User] = 1000                             │
│     Bank vault: +1000 tokens                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## The Complete Withdraw Flow

Now let's trace the withdrawal process:

```text
┌─────────────────────────────────────────────────────────────────────┐
│                       WITHDRAW FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. USER CREATES WITHDRAW REQUEST NOTE                              │
│     ┌──────────────────────────────┐                                │
│     │ Withdraw Request Note        │                                │
│     │  sender: User                │                                │
│     │  inputs: [serial, tag,       │                                │
│     │           note_type]         │                                │
│     │  assets: [withdraw amount]   │                                │
│     │  target: Bank                │                                │
│     └──────────────────────────────┘                                │
│              │                                                       │
│              ▼                                                       │
│  2. BANK CONSUMES REQUEST (Transaction begins)                      │
│     ┌──────────────────────────────┐                                │
│     │ Note script executes:        │                                │
│     │  sender = get_sender()       │                                │
│     │  storage = get_storage()      │                                │
│     │  asset = Asset from inputs   │                                │
│     │  bank_account::withdraw(...) │                                │
│     └──────────────────────────────┘                                │
│              │                                                       │
│              ▼                                                       │
│  3. WITHDRAW METHOD RUNS                                            │
│     ┌──────────────────────────────────────────────────────┐        │
│     │ require_initialized()                 ✓ Passes       │        │
│     │ current_balance = get_depositor_balance(User) → 1000 │        │
│     │ VALIDATE: 1000 >= 400                 ✓ Passes       │  ◀ CRITICAL
│     │ balances[User] = 1000 - 400           → 600          │        │
│     │ create_p2id_note(...)                 → Output note  │        │
│     └──────────────────────────────────────────────────────┘        │
│              │                                                       │
│              ▼                                                       │
│  4. P2ID NOTE CREATED (inside create_p2id_note)                     │
│     ┌──────────────────────────────────────────────────────┐        │
│     │ script_root = storage[10..13]         → MAST digest  │        │
│     │ recipient = note::build_recipient(                    │        │
│     │     serial_num, script_root,                          │        │
│     │     [user.suffix, user.prefix]                        │        │
│     │ )                                                     │        │
│     │ note_idx = output_note::create(tag, note_type,        │        │
│     │     recipient)                                        │        │
│     │ native_account::remove_asset(400 tokens)              │        │
│     │ output_note::add_asset(400 tokens, note_idx)          │        │
│     └──────────────────────────────────────────────────────┘        │
│              │                                                       │
│              ▼                                                       │
│  5. TRANSACTION COMPLETES                                           │
│     Bank storage: balances[User] = 600                              │
│     Bank vault: -400 tokens                                         │
│     Output: P2ID note with 400 tokens → User                        │
│              │                                                       │
│              ▼                                                       │
│  6. USER CONSUMES P2ID NOTE (separate transaction)                  │
│     User's wallet receives 400 tokens                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Try It: Complete End-to-End Test

The complete flow is exercised by the three integration tests built up over the previous chapters, which together cover the same `init → deposit → withdraw` story shown in the diagram above:

- `examples/miden-bank/integration/tests/deposit_test.rs` — introduced in Part 4. Covers the deposit happy path (`deposit_test`) plus two failure paths: `deposit_exceeds_max_should_fail` and `deposit_without_init_should_fail`.
- `examples/miden-bank/integration/tests/init_test.rs` — introduced in Part 6. Exercises the init transaction script (`init_test`) and verifies the `initialized` flag flips from `0` to `1`.
- `examples/miden-bank/integration/tests/withdraw_test.rs` — introduced in Part 7. Runs init + deposit + withdraw end-to-end (`withdraw_test`) and asserts the P2ID output note is created with the correct payload.

Running all three together from the workspace root is the closest thing to a single end-to-end run:

```bash title=">_ Terminal"
cargo test --package integration --release -- --nocapture --test-threads=1
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `release` profile [optimized] target(s)
     Running tests/deposit_test.rs

running 3 tests
test deposit_test ... ok
test deposit_exceeds_max_should_fail ... ok
test deposit_without_init_should_fail ... ok

test result: ok. 3 passed; 0 failed; 0 ignored

     Running tests/init_test.rs

running 1 test
test init_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored

     Running tests/withdraw_test.rs

running 1 test
test withdraw_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

:::note Live network bins
The repository also ships `cargo run --bin initialize` and `cargo run --bin deposit` (under `examples/miden-bank/integration/src/bin/`) for exercising the same flow against a live testnet node. The MockChain integration tests above verify the deposit, init, and withdraw flows end-to-end.
:::

## Summary: All Components

Here's the complete picture of what you've built:

| Component               | Type               | Purpose                     |
| ----------------------- | ------------------ | --------------------------- |
| `bank-account`          | Account Component  | Manages balances and vault  |
| `deposit-note`          | Note Script        | Processes incoming deposits |
| `withdraw-request-note` | Note Script        | Requests withdrawals        |
| `init-tx-script`        | Transaction Script | Initializes the bank        |

| Storage Slot  | Type                     | Content             |
| ------------- | ------------------------ | ------------------- |
| `initialized` | `StorageValue<Word>`     | Initialization flag |
| `balances`    | `StorageMap<Word, Felt>` | Depositor balances  |

| API                              | Purpose               |
| -------------------------------- | --------------------- |
| `active_note::get_sender()`      | Identify note creator |
| `active_note::get_assets()`      | Get attached assets   |
| `active_note::get_storage()`     | Get note parameters   |
| `native_account::add_asset()`    | Receive into vault    |
| `native_account::remove_asset()` | Send from vault       |
| `output_note::create()`          | Create output note    |
| `output_note::add_asset()`       | Attach assets to note |

## Key Security Patterns

Remember these critical patterns from this tutorial:

:::danger Always Validate Before Subtraction

```rust
// ❌ DANGEROUS: Silent underflow!
let new_balance = current_balance - withdraw_amount;

// ✅ SAFE: Validate first
assert!(
    current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
    "Insufficient balance"
);
let new_balance = current_balance - withdraw_amount;
```

:::

:::warning Felt Comparison Operators
Never use `<`, `>` on Felt values directly. Always convert to u64 first:

```rust
// ❌ BROKEN: Produces incorrect results
if current_balance < withdraw_amount { ... }

// ✅ CORRECT: Use as_canonical_u64()
if current_balance.as_canonical_u64() < withdraw_amount.as_canonical_u64() { ... }
```

:::

## Congratulations! 🎉

You've completed the Miden Bank tutorial! You now understand:

- ✅ **Account components** with storage (`StorageValue<Word>` and `StorageMap<Word, Felt>`)
- ✅ **Constants and constraints** for business rules
- ✅ **Asset management** with vault operations
- ✅ **Note scripts** for processing incoming notes
- ✅ **Cross-component calls** via generated bindings
- ✅ **Transaction scripts** for owner operations
- ✅ **Output notes** for sending assets (P2ID pattern)
- ✅ **Security patterns** for safe arithmetic

### Continue Learning

- **[Testing with MockChain](https://docs.miden.xyz/builder/tutorials/rust-compiler/testing)** - Deep dive into testing patterns
- **[Debugging Guide](https://docs.miden.xyz/builder/tutorials/rust-compiler/debugging)** - Troubleshoot common issues
- **[Common Pitfalls](https://docs.miden.xyz/builder/tutorials/rust-compiler/pitfalls)** - Avoid known gotchas

### Build More

Use these patterns to build:

- Token faucets
- DEX contracts
- NFT marketplaces
- Multi-signature wallets
- And more!

:::tip View Complete Source
Explore the complete banking application:

- [All Contracts](https://github.com/0xMiden/miden-tutorials/tree/main/examples/miden-bank/contracts)
- [Integration Tests](https://github.com/0xMiden/miden-tutorials/tree/main/examples/miden-bank/integration/tests)
- [Test Helpers](https://github.com/0xMiden/miden-tutorials/blob/main/examples/miden-bank/integration/src/helpers.rs)
  :::

Happy building on Miden! 🚀
