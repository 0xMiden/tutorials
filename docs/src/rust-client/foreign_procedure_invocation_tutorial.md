---
title: "Foreign Procedure Invocation"
sidebar_position: 7
---

# Foreign Procedure Invocation Tutorial

_Using foreign procedure invocation to craft read-only cross-contract calls in the Miden VM_

## Overview

In previous tutorials we deployed a public counter contract and incremented the count from a different client instance.

In this tutorial we will cover the basics of "foreign procedure invocation" (FPI) in the Miden VM. To demonstrate FPI, we will build a "count copy" smart contract that reads the count from our previously deployed counter contract and copies the count to its own local storage.

Foreign procedure invocation (FPI) is a powerful tool for building smart contracts in the Miden VM. FPI allows one smart contract to call "read-only" procedures in other smart contracts.

The term "foreign procedure invocation" might sound a bit verbose, but it is as simple as one smart contract calling a non-state modifying procedure in another smart contract. The "EVM equivalent" of foreign procedure invocation would be a smart contract calling a read-only function in another contract.

FPI is useful for developing smart contracts that extend the functionality of existing contracts on Miden. FPI is the core primitive used by price oracles on Miden.

## What We Will Build

![count copy FPI diagram](../img/count_copy_fpi_diagram.png)

The diagram above depicts the "count copy" smart contract using foreign procedure invocation to read the count state of the counter contract. After reading the state via FPI, the "count copy" smart contract writes the value returned from the counter contract to storage.

## What we'll cover

- Foreign Procedure Invocation (FPI)
- Building a "count copy" Smart Contract

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly and completed the previous tutorial on deploying the counter contract. We will be working within the same `miden-counter-contract` repository that we created in the [Interacting with Public Smart Contracts](./public_account_interaction_tutorial.md) tutorial.

## Step 1: Set up your repository

We will be using the same repository used in the "Interacting with Public Smart Contracts" tutorial. To set up your repository for this tutorial, first follow up until step two [here](./public_account_interaction_tutorial.md).

## Step 2: Set up the "count reader" contract

Inside of the `masm/accounts/` directory, create the `count_reader.masm` file. This is the smart contract that will read the "count" value from the counter contract.

`masm/accounts/count_reader.masm`:

```masm
use miden::protocol::active_account
use miden::protocol::native_account
use miden::protocol::tx
use miden::core::word
use miden::core::sys

const COUNT_READER_SLOT = word("miden::tutorials::count_reader")

# => [account_id_suffix, account_id_prefix, PROC_HASH(4), foreign_procedure_inputs(16)]
pub proc copy_count
    exec.tx::execute_foreign_procedure
    # => [count, pad(12)]

    push.COUNT_READER_SLOT[0..2]
    # [slot_id_prefix, slot_id_suffix, count, pad(12)]

    exec.native_account::set_item
    # => [OLD_VALUE, pad(12)]

    dropw dropw dropw dropw
    # => []

    exec.sys::truncate_stack
    # => []
end
```

In the count reader smart contract we have a `copy_count` procedure that uses `tx::execute_foreign_procedure` to call the `get_count` procedure in the counter contract.

To call the `get_count` procedure, we push its hash along with the counter contract's ID suffix and prefix.

This is what the stack state should look like before we call `tx::execute_foreign_procedure`:

```text
# => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, foreign_procedure_inputs(16)]
```

`execute_foreign_procedure` always requires exactly 16 `foreign_procedure_inputs` on the stack
below the procedure hash and account ID. Since `get_count` takes no arguments, we pass 16 zero
words (`padw padw padw padw`) as the inputs. After the call, the procedure returns 16 output
elements; the count word sits at the top and we clean up the rest with `dropw dropw dropw dropw`.

After calling the `get_count` procedure in the counter contract, we save the count into the
`miden::tutorials::count_reader` storage slot.

**Note**: _The bracket symbols used in the count copy contract are not valid MASM syntax. These are simply placeholder elements that we will replace with the actual values before compilation._

Inside the `masm/scripts/` directory, create the `reader_script.masm` file:

```masm
use external_contract::count_reader_contract
use miden::core::sys

begin
    padw padw padw padw
    # => [pad(16)]

    push.{get_count_proc_hash}
    # => [GET_COUNT_HASH, pad(16)]

    push.{account_id_prefix}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.{account_id_suffix}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => []

    exec.sys::truncate_stack
    # => []
end
```

**Note**: _`push.{get_count_proc_hash}` is not valid MASM, we will format the string with the value get_count_proc_hash before passing this script code to the assembler._

### Step 3: Set up your `src/main.rs` file:

```rust no_run
use rand::RngCore;
use std::{fs, path::Path, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent,
        AccountStorageMode, AccountType, StorageSlot, StorageSlotName,
    },
    account::AccountId,
    assembly::{
        CodeBuilder,
        DefaultSourceManager,
        Library,
        Module,
        ModuleKind,
        Path as AssemblyPath,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{domain::account::AccountStorageRequirements, Endpoint, GrpcClient},
    transaction::{ForeignAccount, TransactionKernel, TransactionRequestBuilder},
    ClientError, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

fn create_library(
    library_path: &str,
    source_code: &str,
) -> Result<Arc<Library>, Box<dyn std::error::Error>> {
    let source_manager = Arc::new(DefaultSourceManager::default());
    let assembler = TransactionKernel::assembler_with_source_manager(source_manager.clone());
    let module = Module::parser(ModuleKind::Library).parse_str(
        AssemblyPath::new(library_path),
        source_code,
        source_manager,
    )?;
    let library = assembler.assemble_library([module])?;
    Ok(library)
}

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    let keystore_path = std::path::PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = std::path::PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await?;

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);

    // -------------------------------------------------------------------------
    // STEP 1: Create the Count Reader Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating count reader contract.");

    let count_reader_path = Path::new("../masm/accounts/count_reader.masm");
    let count_reader_code = fs::read_to_string(count_reader_path).unwrap();

    let count_reader_slot_name =
        StorageSlotName::new("miden::tutorials::count_reader").expect("valid slot name");
    let count_reader_component_code = CodeBuilder::new()
        .compile_component_code("external_contract::count_reader_contract", &count_reader_code)
        .unwrap();
    let count_reader_component = AccountComponent::new(
        count_reader_component_code,
        vec![StorageSlot::with_value(
            count_reader_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::count_reader_contract", AccountType::all()),
    )
    .unwrap();

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let count_reader_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(count_reader_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "count_reader hash: {:?}",
        count_reader_contract.to_commitment()
    );
    println!("contract id: {:?}", count_reader_contract.id());

    client
        .add_account(&count_reader_contract, false)
        .await
        .unwrap();

    Ok(())
}
```

Run the following command to execute src/main.rs:

```bash
cargo run --release
```

The output of our program will look something like this:

```text
Latest block: 226976

[STEP 1] Creating count reader contract.
count_reader hash: RpoDigest([15888177100833057221, 15548657445961063290, 5580812380698193124, 9604096693288041818])
contract id: "<testnet_account_id>"
```

## Step 4: Import the pre-deployed counter contract

The FPI call needs a counter contract already deployed on-chain. We import the counter contract that was deployed in the [counter contract tutorial](./counter_contract_tutorial.md) by its testnet address:

```rust ignore
// -------------------------------------------------------------------------
// STEP 2: Build & Get State of the Counter Contract
// -------------------------------------------------------------------------
println!("\n[STEP 2] Building counter contract from public state");

// Define the Counter Contract account id from counter contract deploy
let (_, counter_contract_id) =
    AccountId::from_bech32("mtst1apsd609q5966cqra992t4a00tgstrkfk").unwrap();

println!("counter contract id: {:?}", counter_contract_id);

client
    .import_account_by_id(counter_contract_id)
    .await
    .unwrap();

let counter_contract = client
    .get_account(counter_contract_id)
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "Account details: {:?}",
    counter_contract.storage().slots().first().unwrap()
);
```

## Step 5: Call the counter contract via foreign procedure invocation

Add this snippet to the end of your file in the `main()` function:

```rust ignore
// -------------------------------------------------------------------------
// STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
// -------------------------------------------------------------------------
println!("\n[STEP 3] Call counter contract with FPI from count reader contract");

// Derive the get_count procedure hash from the locally compiled counter library.
let counter_contract_path = Path::new("../masm/accounts/counter.masm");
let counter_contract_code = fs::read_to_string(counter_contract_path).unwrap();

// Compile the counter as a component (same path as the deploy binary) to get
// the correct procedure root that matches the on-chain MAST.
let counter_component_code = CodeBuilder::new()
    .compile_component_code("external_contract::counter_contract", &counter_contract_code)
    .unwrap();
let counter_component = AccountComponent::new(
    counter_component_code,
    vec![],
    AccountComponentMetadata::new("external_contract::counter_contract", AccountType::all()),
)
.unwrap();

let get_count_root = counter_component
    .component_code()
    .as_library()
    .get_procedure_root_by_path("external_contract::counter_contract::get_count")
    .expect("get_count export not found");
let get_count_hash = format!("{}", get_count_root);

println!("get_count hash: {:?}", get_count_hash);
println!("counter id prefix: {:?}", counter_contract_id.prefix());
println!("counter id suffix: {:?}", counter_contract_id.suffix());

let script_path = Path::new("../masm/scripts/reader_script.masm");
let script_code_original = fs::read_to_string(script_path).unwrap();
let script_code = script_code_original
    .replace("{get_count_proc_hash}", &get_count_hash)
    .replace(
        "{account_id_suffix}",
        &counter_contract_id.suffix().as_canonical_u64().to_string(),
    )
    .replace(
        "{account_id_prefix}",
        &u64::from(counter_contract_id.prefix()).to_string(),
    );

let account_component_lib = create_library(
    "external_contract::count_reader_contract",
    &count_reader_code,
)
.unwrap();

let tx_script = client
    .code_builder()
    .with_dynamically_linked_library(&account_component_lib)
    .unwrap()
    .compile_tx_script(&script_code)
    .unwrap();

let foreign_account =
    ForeignAccount::public(counter_contract_id, AccountStorageRequirements::default()).unwrap();

let tx_request = TransactionRequestBuilder::new()
    .foreign_accounts([foreign_account])
    .custom_script(tx_script)
    .build()
    .unwrap();

let tx_id = client
    .submit_new_transaction(count_reader_contract.id(), tx_request)
    .await
    .unwrap();

println!(
    "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
    tx_id
);

client.sync_state().await.unwrap();
sleep(Duration::from_secs(5)).await;
client.sync_state().await.unwrap();

// Retrieve final state to confirm the count was copied.
let counter_slot_name =
    StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
let account_1 = client
    .get_account(counter_contract_id)
    .await
    .unwrap()
    .expect("counter contract not found");
println!(
    "counter contract storage: {:?}",
    account_1.storage().get_item(&counter_slot_name)
);

let account_2 = client
    .get_account(count_reader_contract.id())
    .await
    .unwrap()
    .expect("count reader contract not found");
println!(
    "count reader contract storage: {:?}",
    account_2.storage().get_item(&count_reader_slot_name)
);
```

The key here is the use of the `.foreign_accounts()` method on the `TransactionRequestBuilder`. Using this method, it is possible to create transactions with multiple foreign procedure calls.

## Summary

In this tutorial created a smart contract that calls the `get_count` procedure in the counter contract using foreign procedure invocation, and then saves the returned value to its local storage.

The final `src/main.rs` file should look like this:

```rust no_run
use rand::RngCore;
use std::{fs, path::Path, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageSlot, StorageSlotName,
    },
    assembly::{
        CodeBuilder, DefaultSourceManager, Library, Module, ModuleKind,
        Path as AssemblyPath,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{domain::account::AccountStorageRequirements, Endpoint, GrpcClient},
    transaction::{ForeignAccount, TransactionKernel, TransactionRequestBuilder},
    ClientError, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

fn create_library(
    library_path: &str,
    source_code: &str,
) -> Result<Arc<Library>, Box<dyn std::error::Error>> {
    let source_manager = Arc::new(DefaultSourceManager::default());
    let assembler = TransactionKernel::assembler_with_source_manager(source_manager.clone());
    let module = Module::parser(ModuleKind::Library).parse_str(
        AssemblyPath::new(library_path),
        source_code,
        source_manager,
    )?;
    let library = assembler.assemble_library([module])?;
    Ok(library)
}

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    let keystore_path = std::path::PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = std::path::PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await?;

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);

    // -------------------------------------------------------------------------
    // STEP 1: Create the Count Reader Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating count reader contract.");

    let count_reader_path = Path::new("../masm/accounts/count_reader.masm");
    let count_reader_code = fs::read_to_string(count_reader_path).unwrap();

    let count_reader_slot_name =
        StorageSlotName::new("miden::tutorials::count_reader").expect("valid slot name");
    let count_reader_component_code = CodeBuilder::new()
        .compile_component_code(
            "external_contract::count_reader_contract",
            &count_reader_code,
        )
        .unwrap();
    let count_reader_component = AccountComponent::new(
        count_reader_component_code,
        vec![StorageSlot::with_value(
            count_reader_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new(
            "external_contract::count_reader_contract",
            AccountType::all(),
        ),
    )
    .unwrap();

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let count_reader_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(count_reader_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "count_reader hash: {:?}",
        count_reader_contract.to_commitment()
    );
    println!("count_reader id: {:?}", count_reader_contract.id());

    client
        .add_account(&count_reader_contract, false)
        .await
        .unwrap();

    // -------------------------------------------------------------------------
    // STEP 2: Build & Get State of the Counter Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Building counter contract from public state");

    // Define the Counter Contract account id from counter contract deploy
    let (_, counter_contract_id) =
        AccountId::from_bech32("mtst1apsd609q5966cqra992t4a00tgstrkfk").unwrap();

    println!("counter contract id: {:?}", counter_contract_id);

    client
        .import_account_by_id(counter_contract_id)
        .await
        .unwrap();

    let counter_contract = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "Account details: {:?}",
        counter_contract.storage().slots().first().unwrap()
    );

    // -------------------------------------------------------------------------
    // STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Call counter contract with FPI from count reader contract");

    let counter_contract_path = Path::new("../masm/accounts/counter.masm");
    let counter_contract_code = fs::read_to_string(counter_contract_path).unwrap();

    // Compile the counter as a component (same path as the deploy binary) to get
    // the correct procedure root that matches the on-chain MAST.
    let counter_component_code = CodeBuilder::new()
        .compile_component_code("external_contract::counter_contract", &counter_contract_code)
        .unwrap();
    let counter_component = AccountComponent::new(
        counter_component_code,
        vec![],
        AccountComponentMetadata::new("external_contract::counter_contract", AccountType::all()),
    )
    .unwrap();

    let get_count_root = counter_component
        .component_code()
        .as_library()
        .get_procedure_root_by_path("external_contract::counter_contract::get_count")
        .expect("get_count export not found");
    let get_count_hash = format!("{}", get_count_root);

    println!("get_count hash: {:?}", get_count_hash);
    println!("counter id prefix: {:?}", counter_contract_id.prefix());
    println!("counter id suffix: {:?}", counter_contract_id.suffix());

    let script_path = Path::new("../masm/scripts/reader_script.masm");
    let script_code_original = fs::read_to_string(script_path).unwrap();
    let script_code = script_code_original
        .replace("{get_count_proc_hash}", &get_count_hash)
        .replace(
            "{account_id_suffix}",
            &counter_contract_id.suffix().as_canonical_u64().to_string(),
        )
        .replace(
            "{account_id_prefix}",
            &u64::from(counter_contract_id.prefix()).to_string(),
        );

    let account_component_lib = create_library(
        "external_contract::count_reader_contract",
        &count_reader_code,
    )
    .unwrap();

    let tx_script = client
        .code_builder()
        .with_dynamically_linked_library(&account_component_lib)
        .unwrap()
        .compile_tx_script(&script_code)
        .unwrap();

    let foreign_account =
        ForeignAccount::public(counter_contract_id, AccountStorageRequirements::default())
            .unwrap();

    let tx_request = TransactionRequestBuilder::new()
        .foreign_accounts([foreign_account])
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_new_transaction(count_reader_contract.id(), tx_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();
    sleep(Duration::from_secs(5)).await;
    client.sync_state().await.unwrap();

    // Retrieve final state to confirm the count was copied.
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let account_1 = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "counter contract storage: {:?}",
        account_1.storage().get_item(&counter_slot_name)
    );

    let account_2 = client
        .get_account(count_reader_contract.id())
        .await
        .unwrap()
        .expect("count reader contract not found");
    println!(
        "count reader contract storage: {:?}",
        account_2.storage().get_item(&count_reader_slot_name)
    );

    Ok(())
}
```

The output will show the count reader contract being created, the counter contract being imported from testnet, and finally both storage slots reflecting the same count value after the FPI transaction is confirmed.

### Running the example

To run the full example, navigate to the `rust-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run this command:

```bash
cd rust-client
cargo run --release --bin counter_contract_fpi
```

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](unauthenticated_note_how_to.md)
