---
title: "Consuming On-Chain Price Data from the Pragma Oracle"
sidebar_position: 13
---

# Consuming On-Chain Price Data from the Pragma Oracle

_Using the Pragma oracle to get on chain price data_

## Overview

In this tutorial, we will build a simple “price reader” smart contract that will read Bitcoin price data from the on-chain Pragma oracle.

We will use a script to call the `read_price` function in our "price reader" smart contract, which, in turn, calls the Pragma oracle via foreign procedure invocation (FPI). This tutorial lays the foundation for how you can integrate on-chain price data into your DeFi applications on Miden.

## What we'll cover

- Deploying a smart contract that can read oracle price data
- Using foreign procedure invocation to get real time on-chain price data

## Prerequisites

This tutorial assumes you have a basic understanding of Miden assembly, have completed the previous tutorials on using the Rust client, and have completed the tutorial on foreign procedure invocation.

To quickly get up to speed with Miden assembly (MASM), please play around with running Miden programs in the [Miden playground](https://0xMiden.github.io/examples/).

## Step 1: Initialize your repository

Create a new Rust repository for your Miden project and navigate to it with the following command:

```bash
cargo new miden-defi-app
cd miden-defi-app
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
miden-client = { version = "0.14", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "0.14", package = "miden-client-sqlite-store" }
miden-protocol = { version = "0.14" }
rand = { version = "0.9" }
serde = { version = "1", features = ["derive"] }
serde_json = { version = "1.0", features = ["raw_value"] }
tokio = { version = "1.46", features = ["rt-multi-thread", "net", "macros", "fs"] }
rand_chacha = "0.9.0"
```

### Step 1: Set up your `src/main.rs` file

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageMapKey, StorageSlot, StorageSlotName,
    },
    assembly::{
        CodeBuilder, DefaultSourceManager, Module, ModuleKind, Path as AssemblyPath,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{
        domain::account::AccountStorageRequirements,
        Endpoint, GrpcClient,
    },
    transaction::{ForeignAccount, TransactionKernel, TransactionRequestBuilder},
    Client, ClientError, Felt, Word, ZERO,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use std::{fs, path::Path, sync::Arc};

/// Import the oracle + its publishers and return the ForeignAccount list
/// Due to Pragma's decentralized oracle architecture, we need to get the
/// list of all data publisher accounts to read price from via a nested FPI call
pub async fn get_oracle_foreign_accounts(
    client: &mut Client<FilesystemKeyStore>,
    oracle_account_id: AccountId,
    faucet_pair: Word,
) -> Result<Vec<ForeignAccount>, ClientError> {
    client.import_account_by_id(oracle_account_id).await?;
    client.sync_state().await?;

    let oracle_record = client
        .get_account(oracle_account_id)
        .await
        .expect("RPC failed")
        .expect("oracle account not found");

    let storage = oracle_record.storage();

    // The oracle tracks the next free publisher index in a value slot.
    // Publisher slots start at index 2, so the publisher count is `next_index - 2`.
    let next_index_slot =
        StorageSlotName::new("pragma::oracle::next_publisher_index").expect("valid slot name");
    let next_publisher_index = storage
        .get_item(&next_index_slot)
        .expect("oracle is missing the next_publisher_index slot")[0]
        .as_canonical_u64();

    // Publisher account IDs are stored in the `publishers` map, keyed by index.
    let publishers_slot =
        StorageSlotName::new("pragma::oracle::publishers").expect("valid slot name");
    let publisher_ids: Vec<AccountId> = (2..next_publisher_index)
        .map(|index| {
            let key: Word = [Felt::new(index), ZERO, ZERO, ZERO].into();
            let publisher_word = storage
                .get_map_item(&publishers_slot, key)
                .expect("publisher entry missing from oracle storage");
            AccountId::new_unchecked([publisher_word[0], publisher_word[1]])
        })
        .collect();

    // Each publisher exposes its price entries in the `entries` map, keyed by
    // the faucet ID word of the trading pair.
    let entries_slot =
        StorageSlotName::new("pragma::publisher::entries").expect("valid slot name");
    let mut foreign_accounts = Vec::with_capacity(publisher_ids.len() + 1);

    for publisher_id in publisher_ids {
        client.import_account_by_id(publisher_id).await?;

        let storage_requirements = AccountStorageRequirements::new([(
            entries_slot.clone(),
            &[StorageMapKey::new(faucet_pair)],
        )]);

        foreign_accounts.push(ForeignAccount::public(publisher_id, storage_requirements)?);
    }

    // The oracle account itself is also a foreign account. `get_median` reads
    // the publisher registry from the oracle's `publishers` map, so the proofs
    // for those map keys must be requested as well.
    let publisher_index_keys: Vec<StorageMapKey> = (2..next_publisher_index)
        .map(|index| StorageMapKey::new([Felt::new(index), ZERO, ZERO, ZERO].into()))
        .collect();
    foreign_accounts.push(ForeignAccount::public(
        oracle_account_id,
        AccountStorageRequirements::new([(publishers_slot.clone(), publisher_index_keys.iter())]),
    )?);

    client.sync_state().await?;

    Ok(foreign_accounts)
}

fn create_library(
    library_path: &str,
    source_code: &str,
) -> Result<Arc<miden_client::assembly::Library>, Box<dyn std::error::Error>> {
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
    // -------------------------------------------------------------------------
    // Initialize Client
    // -------------------------------------------------------------------------
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

    println!("Latest block: {}", client.sync_state().await?.block_num);

    // -------------------------------------------------------------------------
    // Get all foreign accounts for oracle data
    // -------------------------------------------------------------------------
    let oracle_bech32 = std::env::args()
        .nth(1)
        .expect("Usage: oracle_data_query <ORACLE_BECH32_ID>");
    let (_, oracle_account_id) = AccountId::from_bech32(&oracle_bech32).unwrap();

    // BTC/USD is identified by the faucet ID pair `1:0` (prefix 1, suffix 0).
    // The faucet ID word is laid out as [0, 0, suffix, prefix].
    let pair_prefix: u64 = 1;
    let pair_suffix: u64 = 0;
    let btc_usd_pair: Word =
        [ZERO, ZERO, Felt::new(pair_suffix), Felt::new(pair_prefix)].into();
    let foreign_accounts: Vec<ForeignAccount> =
        get_oracle_foreign_accounts(&mut client, oracle_account_id, btc_usd_pair).await?;

    println!(
        "Oracle accountId prefix: {:?} suffix: {:?}",
        oracle_account_id.prefix(),
        oracle_account_id.suffix()
    );

    // -------------------------------------------------------------------------
    // Create Oracle Reader contract
    // -------------------------------------------------------------------------
    let contract_code =
        fs::read_to_string(Path::new("../masm/accounts/oracle_reader.masm")).unwrap();

    let contract_slot_name =
        StorageSlotName::new("miden::tutorials::oracle_reader").expect("valid slot name");
    let contract_component_code = CodeBuilder::new()
        .compile_component_code("external_contract::oracle_reader", &contract_code)
        .unwrap();
    let contract_component = AccountComponent::new(
        contract_component_code,
        vec![StorageSlot::with_value(
            contract_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::oracle_reader", AccountType::all()),
    )
    .unwrap();

    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    let oracle_reader_contract = AccountBuilder::new(seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(contract_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    client
        .add_account(&oracle_reader_contract, false)
        .await
        .unwrap();

    // -------------------------------------------------------------------------
    // Build the script that calls our `get_price` procedure
    // -------------------------------------------------------------------------
    let script_path = Path::new("../masm/scripts/oracle_reader_script.masm");
    let script_code = fs::read_to_string(script_path).unwrap();

    let library_path = "external_contract::oracle_reader";
    let account_component_lib =
        create_library(library_path, &contract_code).unwrap();

    let tx_script = client
        .code_builder()
        .with_dynamically_linked_library(&account_component_lib)
        .unwrap()
        .compile_tx_script(&script_code)
        .unwrap();

    let tx_increment_request = TransactionRequestBuilder::new()
        .foreign_accounts(foreign_accounts)
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_new_transaction(oracle_reader_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();

    Ok(())
}
```

_Don't run this code just yet, we still need to create our smart contract that queries the oracle_

In the code above, the Pragma oracle account ID is provided as a command-line argument in bech32 form, and the BTC/USD price feed is identified by the faucet ID pair `1:0` (prefix `1`, suffix `0`). The `get_oracle_foreign_accounts` function returns all of the `ForeignAccount`s that you will need to execute the transaction to get the price data from the oracle. Since Pragma's oracle aggregates data from multiple publishers, this function reads the oracle's on-chain publisher registry and collects every publisher account id required to make a successful FPI call.

:::note
The oracle account ID, procedure hash, and faucet pair used in this tutorial reference Pragma's testnet deployment. These values are maintained by Pragma and may change if they redeploy their oracle. For the latest values, check the [Pragma Miden repository](https://github.com/astraly-labs/pragma-miden).
:::

## Step 2: Build the price reader smart contract and script

Just like in previous tutorials, for better code organization we will separate the Miden assembly code from our Rust code.

Create a directory named `masm` at the **root** of your `miden-counter-contract` directory. This will contain our contract and script masm code.

Initialize the `masm` directory:

```bash
mkdir -p masm/accounts masm/scripts
```

This will create:

```text
masm/
├── accounts/
└── scripts/
```

### Oracle price reader smart contract

Below is our oracle price reader contract. It has a single exported procedure: `get_price`

The import `miden::tx` contains the `tx::execute_foreign_procedure` which we will use to read the price from the oracle contract.

#### Here's a breakdown of what the `get_price` procedure does:

1. Pushes the 16 foreign procedure inputs that `tx::execute_foreign_procedure` requires. The first four are the arguments to `get_median` — the BTC/USD faucet ID prefix `1`, suffix `0`, an `amount` of `0`, and a trailing `0` — and the remaining twelve are zero padding.
2. Pushes `0xd1aa2a8b38ccf58f37bb7aa490a8154c1cf89c537144ab23bd1111f13e5a28e8` onto the stack, which is the procedure root of the `get_median` procedure in the oracle.
3. Pushes the Pragma oracle account ID prefix and suffix.
4. Calls `tx::execute_foreign_procedure`, which invokes the `get_median` procedure via foreign procedure invocation. `get_median` returns `[is_tracked, median_price, amount]` on the stack.

Inside of the `masm/accounts/` directory, create the `oracle_reader.masm` file:

```masm
# The oracle account ID, procedure hash, and pair ID below reference
# Pragma's testnet deployment (https://github.com/astraly-labs/pragma-miden).
# If Pragma redeploys their oracle, these values must be updated.

use miden::protocol::tx

# Fetches the current price from the `get_median`
# procedure from the Pragma oracle
# => []
pub proc get_price
    # `execute_foreign_procedure` requires exactly 16 foreign procedure inputs.
    # `get_median` only reads the first four, so the rest are zero padding.
    padw padw padw
    # => [PAD(12)]

    # BTC/USD pair: faucet id prefix `1`, suffix `0`, amount `0`
    push.0.0.0.1
    # => [pair_prefix, pair_suffix, amount, 0, PAD(12)]

    # This is the procedure root of the `get_median` procedure
    push.0xd1aa2a8b38ccf58f37bb7aa490a8154c1cf89c537144ab23bd1111f13e5a28e8
    # => [GET_MEDIAN_HASH, FOREIGN_INPUTS(16)]

    # The Pragma oracle account id: prefix then suffix, leaving suffix on top
    push.17041133956008732928.1562038061251555584
    # => [oracle_id_suffix, oracle_id_prefix, GET_MEDIAN_HASH, FOREIGN_INPUTS(16)]

    exec.tx::execute_foreign_procedure
    # => [is_tracked, median_price, amount, PAD(13)]

    debug.stack
    # => [is_tracked, median_price, amount, PAD(13)]

    dropw dropw dropw dropw
end
```

**Note**: _It's a good habit to add comments above each line of MASM code with the expected stack state. This improves readability and helps with debugging._

### Create the script which calls the `get_price` procedure

This is a Miden assembly script that will call the `get_price` procedure during the transaction.

Inside of the `masm/scripts/` directory, create the `oracle_reader_script.masm` file:

```masm
use external_contract::oracle_reader

begin
    exec.oracle_reader::get_price
end
```

## Step 3: Run the program

Run the following command to execute src/main.rs:

```bash
cargo run --release
```

The output of our program will look something like this:

```text
Latest block: 806773
Oracle accountId prefix: V0(AccountIdPrefixV0 { prefix: 17041133956008732928 }) suffix: 1562038061251555584
Stack state before step 11449:
├──  0: 1
├──  1: 76307450000
├──  2: 0
├──  3: 0
├──  4: 0
├──  5: 0
├──  6: 0
├──  7: 0
├──  8: 0
├──  9: 0
├── 10: 0
├── 11: 0
├── 12: 0
├── 13: 0
├── 14: 0
├── 15: 0
├── 16: 0
├── 17: 0
├── 18: 0
├── 19: 0
├── 20: 0
├── 21: 0
├── 22: 0
├── 23: 0
├── 24: 0
├── 25: 0
├── 26: 0
├── 27: 0
├── 28: 0
├── 29: 0
├── 30: 0
└── 31: 0

View transaction on MidenScan: https://testnet.midenscan.com/tx/0x28dbb2ea1270884701e8f4875032db675ab9dfff13c3caaa5e53adfcf56e383b
```

The `get_median` procedure leaves three values on the stack. Index `0` holds `is_tracked` — `1` when Pragma tracks the requested pair. Index `1` holds the median price; in the output above it is `76307450000`, which is `$76307.45` once the 6 decimal places are applied. Index `2` holds the `amount` value that was passed into the call. Pragma publishes several price feeds on testnet; this tutorial reads the `BTC/USD` feed.

### Running the tutorial

To run this tutorial end-to-end, navigate to the `rust-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run:

```bash
cd rust-client
cargo run --release --bin oracle_data_query -- <ORACLE_BECH32_ID>
```

where `<ORACLE_BECH32_ID>` is Pragma's deployed oracle account ID on testnet.

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](./unauthenticated_note_how_to.md)
