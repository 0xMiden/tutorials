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
│     │ current_balance = get_balance(User)   → 1000         │        │
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

Let's create a comprehensive test that exercises the entire bank system:

```rust title="integration/tests/part8_complete_flow_test.rs"
use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, create_testing_note_from_package,
    AccountCreationConfig, NoteCreationConfig,
};
use miden_client::{
    account::{StorageMap, StorageSlot, StorageSlotName},
    asset::{Asset, FungibleAsset},
    note::{P2idNote, P2idNoteStorage, Note, NoteAssets, NoteMetadata, NoteTag, NoteType},
    transaction::{RawOutputNote, TransactionScript},
    Felt, Word,
};
use miden_client::auth::AuthSchemeId;
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Complete end-to-end test of the Miden Bank
///
/// This test exercises:
/// 1. Bank initialization via transaction script
/// 2. Deposit via deposit-note
/// 3. Withdrawal via withdraw-request-note
/// 4. Balance verification at each step
#[tokio::test]
async fn test_complete_bank_flow() -> anyhow::Result<()> {
    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║            MIDEN BANK - COMPLETE FLOW TEST                   ║");
    println!("╚══════════════════════════════════════════════════════════════╝");

    // ═══════════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════════
    println!("\n📦 Setting up test environment...");

    let mut builder = MockChain::builder();

    let deposit_amount: u64 = 1000;
    let withdraw_amount: u64 = 400;

    // Create a faucet to mint test assets
    let faucet =
        builder.add_existing_basic_faucet(Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 }, "TEST", deposit_amount, Some(10))?;

    // Create note sender account (the depositor)
    let sender = builder.add_existing_wallet_with_assets(
        Auth::BasicAuth { auth_scheme: AuthSchemeId::Falcon512Poseidon2 },
        [FungibleAsset::new(faucet.id(), deposit_amount)?.into()],
    )?;
    println!("   ✓ Faucet and sender wallet created");

    // Build all packages
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);
    let deposit_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/deposit-note"),
        true,
    )?);
    let init_tx_script_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/init-tx-script"),
        true,
    )?);
    let withdraw_request_note_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/withdraw-request-note"),
        true,
    )?);
    println!("   ✓ All packages built");

    // Create named storage slots
    let initialized_slot =
        StorageSlotName::new("miden_bank_account::bank::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden_bank_account::bank::balances")
            .expect("Valid slot name");

    // Create bank account with storage slots
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
    println!("   ✓ Bank account created: {:?}", bank_account.id());

    // Create deposit note with assets
    let fungible_asset = FungibleAsset::new(faucet.id(), deposit_amount)?;
    let note_assets = NoteAssets::new(vec![Asset::Fungible(fungible_asset)])?;
    let deposit_note = create_testing_note_from_package(
        deposit_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            assets: note_assets,
            ..Default::default()
        },
    )?;

    // Craft withdraw request note with 10-Felt input layout
    let p2id_tag = NoteTag::with_account_target(sender.id());
    let p2id_tag_felt = Felt::new(p2id_tag.as_u32() as u64);

    let p2id_output_note_serial_num = Word::from([
        Felt::new(0x1234567890abcdef),
        Felt::new(0xfedcba0987654321),
        Felt::new(0xdeadbeefcafebabe),
        Felt::new(0x0123456789abcdef),
    ]);

    let note_type_felt = Felt::new(1); // Public

    // Get the P2ID script root (Poseidon2-hashed MAST root)
    let p2id_script_root = P2idNote::script_root();

    // Note storage: 14 Felts
    // [0-3]: withdraw asset (amount, 0, faucet_suffix, faucet_prefix)
    // [4-7]: serial_num
    // [8]: tag
    // [9]: note_type
    // [10-13]: P2ID script_root
    let withdraw_request_note_storage = vec![
        Felt::new(withdraw_amount),
        Felt::new(0),
        faucet.id().suffix(),
        faucet.id().prefix().as_felt(),
        p2id_output_note_serial_num[0],
        p2id_output_note_serial_num[1],
        p2id_output_note_serial_num[2],
        p2id_output_note_serial_num[3],
        p2id_tag_felt,
        note_type_felt,
        p2id_script_root[0],
        p2id_script_root[1],
        p2id_script_root[2],
        p2id_script_root[3],
    ];

    let withdraw_request_note = create_testing_note_from_package(
        withdraw_request_note_package.clone(),
        sender.id(),
        NoteCreationConfig {
            storage: withdraw_request_note_storage,
            ..Default::default()
        },
    )?;

    // Add to builder
    builder.add_account(bank_account.clone())?;
    builder.add_output_note(RawOutputNote::Full(deposit_note.clone()));
    builder.add_output_note(RawOutputNote::Full(withdraw_request_note.clone()));

    let mut mock_chain = builder.build()?;
    println!("   ✓ MockChain built");

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Initialize the bank
    // ═══════════════════════════════════════════════════════════════════
    println!("\n1️⃣  INITIALIZING BANK...");

    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new((*init_program).clone());

    let init_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[], &[])?
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    bank_account.apply_delta(&executed_init.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;

    println!("   ✓ Bank initialized (storage[0] = [1, 0, 0, 0])");

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Deposit tokens
    // ═══════════════════════════════════════════════════════════════════
    println!("\n2️⃣  DEPOSITING TOKENS...");
    println!("   Deposit amount: {} tokens", deposit_amount);

    let deposit_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[deposit_note.id()], &[])?
        .build()?;

    let executed_deposit = deposit_tx_context.execute().await?;
    bank_account.apply_delta(&executed_deposit.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_deposit)?;
    mock_chain.prove_next_block()?;

    // Verify balance after deposit
    let depositor_key = Word::from([
        sender.id().prefix().as_felt(),
        sender.id().suffix(),
        faucet.id().prefix().as_felt(),
        faucet.id().suffix(),
    ]);
    let balance_after_deposit = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;
    println!(
        "   ✓ Bank processed deposit, balance: {} tokens",
        balance_after_deposit[3].as_canonical_u64()
    );

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Withdraw tokens
    // ═══════════════════════════════════════════════════════════════════
    println!("\n3️⃣  WITHDRAWING TOKENS...");
    println!("   Withdraw amount: {} tokens", withdraw_amount);

    // Build expected P2ID output note
    let recipient = P2idNoteStorage::new(sender.id()).into_recipient(p2id_output_note_serial_num);
    let p2id_output_note_asset = FungibleAsset::new(faucet.id(), withdraw_amount)?;
    let p2id_output_note_assets = NoteAssets::new(vec![p2id_output_note_asset.into()])?;
    let p2id_output_note_metadata = NoteMetadata::new(bank_account.id(), NoteType::Public)
        .with_tag(p2id_tag);
    let p2id_output_note = Note::new(
        p2id_output_note_assets,
        p2id_output_note_metadata,
        recipient,
    );

    let withdraw_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[withdraw_request_note.id()], &[])?
        .extend_expected_output_notes(vec![RawOutputNote::Full(p2id_output_note)])
        .build()?;

    let executed_withdraw = withdraw_tx_context.execute().await?;
    bank_account.apply_delta(&executed_withdraw.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_withdraw)?;
    mock_chain.prove_next_block()?;

    println!("   ✓ Bank processed withdraw request");
    println!("   ✓ P2ID output note created for sender");

    // Verify final balance
    let final_balance = bank_account.storage().get_map_item(&balances_slot, depositor_key)?;
    let final_balance_amount = final_balance[3].as_canonical_u64();
    let expected_final = deposit_amount - withdraw_amount;

    println!("   ✓ Final balance verified: {} tokens", final_balance_amount);

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    println!("\n╔══════════════════════════════════════════════════════════════╗");
    println!("║                      TEST SUMMARY                            ║");
    println!("╠══════════════════════════════════════════════════════════════╣");
    println!(
        "║  Initial deposit:     {:>6} tokens                          ║",
        deposit_amount
    );
    println!(
        "║  Withdrawal:         -{:>6} tokens                          ║",
        withdraw_amount
    );
    println!(
        "║  Final balance:       {:>6} tokens                          ║",
        final_balance_amount
    );
    println!("║                                                              ║");
    println!("║  ✅ All operations completed successfully!                   ║");
    println!("╚══════════════════════════════════════════════════════════════╝");

    assert_eq!(
        final_balance_amount, expected_final,
        "Final balance should be deposit - withdraw"
    );

    Ok(())
}
```

Run the complete test from the project root:

```bash title=">_ Terminal"
cargo test --package integration test_complete_bank_flow -- --nocapture
```

<details>
<summary>Expected output</summary>

```text
   Compiling integration v0.1.0 (/path/to/miden-bank/integration)
    Finished `test` profile [unoptimized + debuginfo] target(s)
     Running tests/part8_complete_flow_test.rs

running 1 test
╔══════════════════════════════════════════════════════════════╗
║            MIDEN BANK - COMPLETE FLOW TEST                   ║
╚══════════════════════════════════════════════════════════════╝

📦 Setting up test environment...
   ✓ Faucet and sender wallet created
   ✓ All packages built
   ✓ Bank account created: 0x...
   ✓ MockChain built

1️⃣  INITIALIZING BANK...
   ✓ Bank initialized (storage[0] = [1, 0, 0, 0])

2️⃣  DEPOSITING TOKENS...
   Deposit amount: 1000 tokens
   ✓ Bank processed deposit, balance: 1000 tokens

3️⃣  WITHDRAWING TOKENS...
   Withdraw amount: 400 tokens
   ✓ Bank processed withdraw request
   ✓ P2ID output note created for sender
   ✓ Final balance verified: 600 tokens

╔══════════════════════════════════════════════════════════════╗
║                      TEST SUMMARY                            ║
╠══════════════════════════════════════════════════════════════╣
║  Initial deposit:       1000 tokens                          ║
║  Withdrawal:         -   400 tokens                          ║
║  Final balance:          600 tokens                          ║
║                                                              ║
║  ✅ All operations completed successfully!                   ║
╚══════════════════════════════════════════════════════════════╝
test test_complete_bank_flow ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
```

</details>

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
