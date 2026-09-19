---
title: "How to Use Mappings in Miden Assembly"
sidebar_position: 10
---

# How to Use Mappings in Miden Assembly

_Using mappings in Miden assembly for storing key value pairs_

[View the complete runnable Rust example](https://github.com/0xMiden/tutorials/blob/main/rust-client/src/bin/mapping_example.rs)

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v016-examples).

## Overview

In this example, we will explore how to use mappings in Miden Assembly. Mappings are essential data structures that store key-value pairs. We will demonstrate how to create an account that contains a mapping and then call a procedure in that account to update the mapping.

At a high level, this example involves:

- Setting up an account with a mapping stored in one of its storage slots.
- Writing a smart contract in Miden Assembly that includes procedures to read from and write to the mapping.
- Creating a transaction script that calls these procedures.
- Using Rust code to deploy the account and submit a transaction that updates the mapping.

## What we'll cover

- **How to Use Mappings in Miden Assembly:** See how to create a smart contract that uses a mapping.
- **How to Link Libraries in Miden Assembly:** Demonstrate how to link procedures across Accounts, Notes, and Scripts.

## Step-by-step process

1. **Setting up an account with a mapping**  
   In this step, you create an account that has a storage slot configured as a mapping. The account smart contract code (shown below) defines procedures to write to and read from this mapping.

2. **Creating a script that calls a procedure in the account:**  
   Next, you create a transaction script that calls the procedures defined in the account. This script sends the key-value data and then invokes the account procedure, which updates the mapping.

3. **How to read and write to a mapping in MASM:**  
   Finally, we demonstrate how to use MASM instructions to interact with the mapping. The smart contract uses standard procedures to set a mapping item, retrieve a value from the mapping, and get the current mapping root.

---

### Example of smart contract that uses a mapping

```masm
use miden::protocol::active_account
use miden::protocol::native_account
use miden::core::sys
use {StorageMapKey} from miden::protocol::types

# CONSTANTS
# =================================================================================================

const MAP_SLOT = word("miden::tutorials::mapping::map")

# PUBLIC INTERFACE
# =================================================================================================

#! Stores VALUE under KEY in the mapping.
#!
#! Inputs:  [KEY, VALUE, pad(8)]
#! Outputs: [pad(16)]
#!
#! Invocation: call
@account_procedure
pub proc write_to_map(key: StorageMapKey, value: word)
    # the storage map is in the mapping slot
    push.MAP_SLOT[0..2]
    # => [slot_id_suffix, slot_id_prefix, KEY, VALUE, pad(8)]

    # set the key-value pair in the map
    exec.native_account::set_map_item
    # => [OLD_VALUE, pad(12)]

    dropw
    # => [pad(16)]
end

#! Returns the VALUE stored under KEY in the mapping.
#!
#! Inputs:  [KEY, pad(12)]
#! Outputs: [VALUE, pad(12)]
#!
#! Invocation: call
@account_procedure
pub proc get_value_in_map(key: StorageMapKey) -> word
    # the storage map is in the mapping slot
    push.MAP_SLOT[0..2]
    # => [slot_id_suffix, slot_id_prefix, KEY, pad(12)]

    exec.active_account::get_map_item
    # => [VALUE, pad(12)]
end

#! Returns the CURRENT_ROOT of the mapping.
#!
#! Inputs:  [pad(16)]
#! Outputs: [CURRENT_ROOT, pad(12)]
#!
#! Invocation: call
@account_procedure
pub proc get_current_map_root() -> word
    # get the current root from the mapping slot
    push.MAP_SLOT[0..2] exec.active_account::get_item
    # => [CURRENT_ROOT, pad(16)]

    exec.sys::truncate_stack
    # => [CURRENT_ROOT, pad(12)]
end
```

### Explanation of the assembly code

- **write_to_map:**  
  The procedure takes a key and a value as inputs. It pushes the slot ID prefix and suffix for the mapping slot onto the stack, then calls the `set_map_item` procedure from the account library to update the mapping. After updating the map, it drops the old value.
- **get_value_in_map:**  
  This procedure takes a key as input and retrieves the corresponding value from the mapping by calling `get_map_item` after pushing the mapping slot ID.

- **get_current_map_root:**  
  This procedure retrieves the current root of the mapping by calling `get_item` with the mapping slot ID and then truncating the stack to leave only the mapping root.

The Rust account below uses `NoAuth`, so anyone can import its public state and submit a mapping update without a signature. `NoAuth` handles fee payment and nonce changes; incrementing a nonce does not itself grant authorization. Use an appropriate authentication component when writes should be restricted.

### Transaction script that calls the smart contract

```masm
use miden_by_example::mapping_example_contract
use miden::core::sys

#! Writes a mapping entry, reads it, and returns the current map root.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [CURRENT_ROOT, pad(12)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#! - CURRENT_ROOT is the mapping's Merkle root after the write.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word) -> word
    dropw
    # => [pad(16)]

    push.1.2.3.4
    push.0.0.0.0
    # => [KEY, VALUE, pad(16)]

    call.mapping_example_contract::write_to_map
    # => [pad(24)]

    push.0.0.0.0
    # => [KEY, pad(24)]

    call.mapping_example_contract::get_value_in_map
    # => [VALUE, pad(24)]

    dropw
    # => [pad(24)]

    call.mapping_example_contract::get_current_map_root
    # => [CURRENT_ROOT, pad(20)]

    exec.sys::truncate_stack
    # => [CURRENT_ROOT, pad(12)]
end
```

### Explanation of the transaction script

The transaction script does the following:

- It pushes the value with `push.1.2.3.4`, then the key with `push.0.0.0.0`. The last pushed element is on top, so the stored value is `[4, 3, 2, 1]` and the key is `[0, 0, 0, 0]`.
- It calls the `write_to_map` procedure, which is defined in the account’s smart contract. This updates the mapping in the account.
- It then pushes the key again and calls `get_value_in_map` to retrieve the value associated with the key.
- Finally, it calls `get_current_map_root` to get the current state (root) of the mapping.

The script calls the `write_to_map` procedure in the account which writes the key value pair to the mapping.

---

### Rust code that sets everything up

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-mappings
cd miden-mappings
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Add these dependencies and the development profile to your `Cargo.toml`:

```toml
[dependencies]
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.16.0", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.16.0", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.16.0" }
rand = { version = "0.10" }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

Below is the Rust code that deploys the smart contract, creates the transaction script, and submits a transaction to update the mapping in the account:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    ClientError,
    account::{
        AccountBuilder, AccountComponent, AccountType, StorageMap, StorageMapKey, StorageSlot,
        StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let network = TutorialNetwork::from_env()?;
    let endpoint = network.endpoint();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
        &endpoint, timeout_ms,
    )));

    // Initialize keystore
    let keystore_path = PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await?;

    let sync_summary = client.sync_state().await.unwrap();
    println!("Latest block: {}", sync_summary.block_num);
    let fee_config = FeeConfig::from_client(&client, network).await?;

    // -------------------------------------------------------------------------
    // STEP 1: Deploy a smart contract with a mapping
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Deploy a smart contract with a mapping");

    // Read the MASM source from the tutorials repository.
    let account_code =
        std::fs::read_to_string("../tutorials/masm/accounts/mapping_example_contract.masm")
            .unwrap();

    // Storage slots are named in v0.16; the component only needs its mapping slot.
    let storage_map = StorageMap::new();
    let map_slot_name =
        StorageSlotName::new("miden::tutorials::mapping::map").expect("valid slot name");
    let storage_slot_map = StorageSlot::with_map(map_slot_name.clone(), storage_map.clone());

    // Compile the account code into `AccountComponent` with one storage slot
    let component_code = client
        .code_builder()
        .compile_component_code("miden_by_example::mapping_example_contract", &account_code)
        .unwrap();
    let mapping_contract_component = AccountComponent::new(
        component_code,
        vec![storage_slot_map],
        AccountComponentMetadata::new("miden_by_example::mapping_example_contract"),
    )
    .unwrap();

    // Init seed for the mapping contract
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Build the new `Account` with the component
    let mapping_example_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(mapping_contract_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build()
        .unwrap();

    client
        .add_account(&mapping_example_contract, false)
        .await
        .unwrap();
    fund_account_for_fees(&mut client, mapping_example_contract.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // STEP 2: Call the Mapping Contract with a Script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call Mapping Contract With Script");

    let script_code =
        std::fs::read_to_string("../tutorials/masm/scripts/mapping_example_script.masm").unwrap();

    // Compile the transaction script with the account code linked as a
    // module on the same `CodeBuilder` chain.
    let tx_script = client
        .code_builder()
        .with_linked_module("miden_by_example::mapping_example_contract", &account_code)
        .unwrap()
        .compile_tx_script(&script_code)
        .unwrap();

    // Build a transaction request with the custom script
    let tx_increment_request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .unwrap();

    // Execute and submit the transaction
    let tx_id = client
        .submit_tutorial_transaction(mapping_example_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await.unwrap();

    let account = client
        .get_account(mapping_example_contract.id())
        .await
        .unwrap()
        .expect("mapping contract not found");
    let key = StorageMapKey::empty();
    println!(
        "Mapping state\n Index: {:?}\n Key: {:?}\n Value: {:?}",
        map_slot_name,
        key,
        account.storage().get_map_item(&map_slot_name, key)
    );
    let value = account.storage().get_map_item(&map_slot_name, key).unwrap();
    assert_eq!(
        value
            .iter()
            .map(|felt| felt.as_canonical_u64())
            .collect::<Vec<_>>(),
        vec![4, 3, 2, 1],
        "the mapping must store the value written by the transaction script",
    );

    Ok(())
}
```

### What the Rust code does

- **Client Initialization:**  
  The client connects to Miden testnet and uses a SQLite store to track accounts, notes, and transactions.

- **Deploying the Smart Contract:**  
  The account MASM is compiled into an `AccountComponent` with a named map slot. `AccountBuilder` creates the account locally; consuming its native-asset funding note publishes it on-chain.

- **Creating and Executing a Transaction Script:**  
  A separate MASM script is compiled into a `TransactionScript`. This script calls the smart contract's procedures to write to and then read from the mapping.

- **Displaying the Result:**  
  Finally, after the transaction is processed, the code reads the updated state of the mapping in the account.

---

### Running the example

For the standalone Cargo project, save the Rust code as `src/main.rs` and run `TUTORIAL_NETWORK=testnet cargo run --release`.

To run the checked-in example, return to the root of the [tutorials repository](https://github.com/0xMiden/tutorials/) and run:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin mapping_example
```

This example shows how the script calls the procedure in the account, which then updates the mapping stored within the account. The mapping update is verified by reading the mapping’s key-value pair after the transaction completes.

### Continue learning

Next tutorial: [How to Create Notes in Miden Assembly](creating_notes_in_masm_tutorial.md)
