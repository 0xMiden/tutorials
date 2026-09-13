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
┌────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE BANK SYSTEM                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ Components Built:                                                      │
│   ┌───────────────────────┬───────────────────────────────────┐        │
│   │ bank-account          │ Storage + deposit() + withdraw()  │        │
│   ├───────────────────────┼───────────────────────────────────┤        │
│   │ deposit-note          │ Note script → account.deposit()   │        │
│   ├───────────────────────┼───────────────────────────────────┤        │
│   │ withdraw-request-note │ Note script → account.withdraw()  │        │
│   ├───────────────────────┼───────────────────────────────────┤        │
│   │ init-tx-script        │ Transaction script → initialize() │        │
│   └───────────────────────┴───────────────────────────────────┘        │
│                                                                        │
│ Storage Layout:                                                        │
│   ┌───────────────────────┬──────────────────────────────────┐         │
│   │ initialized (Value)   │ Word: [1, 0, 0, 0] when ready    │         │
│   ├───────────────────────┼──────────────────────────────────┤         │
│   │ balances (StorageMap) │ Balance per user and asset class │         │
│   └───────────────────────┴──────────────────────────────────┘         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## The Complete Deposit Flow

Let's trace through exactly what happens when a user deposits tokens:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              DEPOSIT FLOW                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ 1. USER CREATES DEPOSIT NOTE                                           │
│    ┌─────────────────────────┐                                         │
│    │ Deposit Note            │                                         │
│    │   sender: User          │                                         │
│    │   assets: [1000 tokens] │                                         │
│    │   script: deposit-note  │                                         │
│    │   consumed by: Bank     │                                         │
│    └─────────────────────────┘                                         │
│             │                                                          │
│             ▼                                                          │
│ 2. BANK CONSUMES THE NOTE                                              │
│    ┌────────────────────────────────────────────────────┐              │
│    │ Transaction begins; note script executes           │              │
│    │ Vault is credited when deposit() calls add_asset() │              │
│    └────────────────────────────────────────────────────┘              │
│             │                                                          │
│             ▼                                                          │
│ 3. NOTE SCRIPT CALLS THE BANK COMPONENT                                │
│    ┌────────────────────────────────────────────────────────────┐      │
│    │ depositor = active_note::get_sender() → User's AccountId   │      │
│    │ assets = active_note::get_initial_assets() → [1000 tokens] │      │
│    │ for asset in assets:                                       │      │
│    │     account.deposit(depositor, asset)                      │      │
│    └────────────────────────────────────────────────────────────┘      │
│             │                                                          │
│             ▼                                                          │
│ 4. DEPOSIT METHOD VALIDATES AND RECEIVES THE ASSET                     │
│    ┌─────────────────────────────────────────────────────┐             │
│    │ require_initialized()                          ✓    │             │
│    │ assert asset.is_fungible()                     ✓    │             │
│    │ assert 0 < amount <= MAX_DEPOSIT (1,000,000)    ✓   │             │
│    │ native_account::add_asset(asset) → Credit vault     │             │
│    │ balances[User, asset class] += 1000 → Update ledger │             │
│    └─────────────────────────────────────────────────────┘             │
│             │                                                          │
│             ▼                                                          │
│ 5. TRANSACTION COMMITS                                                 │
│    ┌──────────────────────────────────┐                                │
│    │ Depositor's ledger balance: 1000 │                                │
│    │ Bank vault: +1000 tokens         │                                │
│    └──────────────────────────────────┘                                │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## The Complete Withdraw Flow

Now let's trace the withdrawal process:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                             WITHDRAW FLOW                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ 1. USER CREATES WITHDRAWAL REQUEST NOTE                                │
│    ┌───────────────────────────────────────────────────────┐           │
│    │ Withdrawal Request Note                               │           │
│    │   sender: User                                        │           │
│    │   assets: []                                          │           │
│    │   storage (14 Felts):                                 │           │
│    │     asset (4), serial (4), tag, type, script root (4) │           │
│    │   requested amount: 500 tokens                        │           │
│    │   consumed by: Bank                                   │           │
│    └───────────────────────────────────────────────────────┘           │
│             │                                                          │
│             ▼                                                          │
│ 2. BANK CONSUMES THE REQUEST                                           │
│    ┌─────────────────────────────────────────────────────┐             │
│    │ Note script reads active_note::get_storage()        │             │
│    │ Reconstructs the requested asset from storage[0..4] │             │
│    │ Calls account.withdraw(asset, serial, tag, type)    │             │
│    └─────────────────────────────────────────────────────┘             │
│             │                                                          │
│             ▼                                                          │
│ 3. WITHDRAW METHOD VALIDATES AND UPDATES THE LEDGER                    │
│    ┌────────────────────────────────────────────────┐                  │
│    │ require_initialized()                       ✓  │                  │
│    │ assert asset.is_fungible()                  ✓  │                  │
│    │ User = active_note::get_sender()               │                  │
│    │ current_balance = 1000                         │                  │
│    │ assert current_balance >= 500              ✓   │                  │
│    │ balances[User, asset class] = 1000 - 500 = 500 │                  │
│    │ create_p2id_note(...) → Output note            │                  │
│    └────────────────────────────────────────────────┘                  │
│             │                                                          │
│             ▼                                                          │
│ 4. P2ID NOTE IS CREATED                                                │
│    ┌──────────────────────────────────────────────────────┐            │
│    │ script_root = storage[10..14]                        │            │
│    │ recipient = note::build_recipient(                   │            │
│    │     serial, script_root, [user.suffix, user.prefix]) │            │
│    │ note_idx = output_note::create(tag, type, recipient) │            │
│    │ native_account::remove_asset(500 tokens)             │            │
│    │ output_note::add_asset(500 tokens, note_idx)         │            │
│    └──────────────────────────────────────────────────────┘            │
│             │                                                          │
│             ▼                                                          │
│ 5. TRANSACTION COMMITS                                                 │
│    ┌───────────────────────────────────────────────────────────┐       │
│    │ Depositor's ledger balance: 500                           │       │
│    │ Bank vault: -500 tokens                                   │       │
│    │ Output: public or private P2ID carrying 500 tokens → User │       │
│    └───────────────────────────────────────────────────────────┘       │
│             │                                                          │
│             ▼                                                          │
│ 6. USER CONSUMES P2ID IN A SEPARATE TRANSACTION                        │
│    ┌──────────────────────────────────────┐                            │
│    │ P2ID recipient check passes for User │                            │
│    │ User's wallet receives 500 tokens    │                            │
│    └──────────────────────────────────────┘                            │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Try It: Complete End-to-End Test

The complete flow is exercised by the three integration test files built up over the previous chapters, which together cover the same `init → deposit → withdraw` story shown in the diagram above:

- `examples/miden-bank/integration/tests/deposit_test.rs` — introduced in Part 4. Covers the deposit happy path (`deposit_test`) plus rejection tests for excessive deposits, deposits before initialization, and NFTs with zero padding in their value word.
- `examples/miden-bank/integration/tests/init_test.rs` — introduced in Part 6. Exercises the init transaction script (`init_test`) and verifies the `initialized` flag flips from `0` to `1`.
- `examples/miden-bank/integration/tests/withdraw_test.rs` — introduced in Part 7. Runs init + deposit + withdraw end-to-end (`withdraw_test`) for both public and private outputs, rejects consumption by another account, and verifies the depositor receives the withdrawn tokens.

Run the complete suite from the workspace root:

```bash title=">_ Terminal"
cargo test --package integration --release -- --nocapture --test-threads=1
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `release` profile [optimized] target(s)
     Running tests/deposit_test.rs

running 4 tests
test deposit_test ... ok
test deposit_exceeds_max_should_fail ... ok
test deposit_without_init_should_fail ... ok
test deposit_nft_with_zero_padding_should_fail ... ok

test result: ok. 4 passed; 0 failed; 0 ignored

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
The repository also ships `cargo run --bin initialize` and `cargo run --bin deposit` (under `examples/miden-bank/integration/src/bin/`) for exercising the same flow against a live testnet node. The deposit bin attaches 1,000 native base units, and both binaries wait for actual transaction commitment before reporting success. Testnet charges fees: each binary prints the new account ID and waits for a public native-token P2ID. Request funding for that ID from the testnet faucet while it waits; the helper consumes the funding note before proceeding. The MockChain tests above verify initialization, deposit, and withdrawal without external funding.
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

| API                                 | Purpose                           |
| ----------------------------------- | --------------------------------- |
| `active_note::get_sender()`         | Identify note creator             |
| `active_note::get_initial_assets()` | Get creation-time attached assets |
| `active_note::get_storage()`        | Get note parameters               |
| `native_account::add_asset()`       | Receive into vault                |
| `native_account::remove_asset()`    | Send from vault                   |
| `output_note::create()`             | Create output note                |
| `output_note::add_asset()`          | Attach assets to note             |

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

:::note Felt Comparison Operators
Direct `Felt` comparisons use canonical integer ordering in the current SDK. Both forms below are valid; this tutorial uses the explicit `u64` form for quantity checks:

```rust
// Direct comparison of canonical Felt values.
if current_balance < withdraw_amount { ... }

// Equivalent comparison with explicit integer conversion.
if current_balance.as_canonical_u64() < withdraw_amount.as_canonical_u64() { ... }
```

Always perform this check before subtracting. Conversion after modular underflow cannot recover the intended balance.

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
