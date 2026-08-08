---
title: "Consuming On-Chain Price Data from the Pragma Oracle"
sidebar_position: 13
---

# Consuming On-Chain Price Data from the Pragma Oracle

_Using the Pragma oracle to get on chain price data_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v017-examples).

## Overview

In this tutorial, we will build a simple “price reader” smart contract that will read Bitcoin price data from the on-chain Pragma oracle.

We will use a script to call the `get_price` procedure in our reader account, which invokes Pragma through foreign procedure invocation (FPI). This example demonstrates the call plumbing and discards the returned price. An application would need to validate and use the result.

## What we'll cover

- Deploying a smart contract that can read oracle price data
- Using foreign procedure invocation to query published on-chain price data

## Prerequisites

:::note v0.17 deployment

Pragma's [published deployment table](https://github.com/astraly-labs/pragma-miden#deployments)
lists a Miden v0.17 testnet oracle at `mtst1aqxnneud7y34z5gwc5z8vu95pcsdmcxm`.
Use the current deployment's account ID, `get_median` procedure root, and pair identifiers.
The procedure root must match the deployed code, which Pragma can upgrade.

The [run commands below](#step-3-run-the-program) include the deployment and
procedure root verified against testnet on October 8, 2026.

The reader assumes the named slots `pragma::oracle::next_publisher_index`,
`pragma::oracle::publishers`, and `pragma::publisher::entries`. Check these slots,
the publisher ID layout and index range, and the return values against that deployment.

:::

This tutorial assumes you have a basic understanding of Miden assembly, have completed the previous tutorials on using the Rust client, and have completed the tutorial on foreign procedure invocation.

To quickly get up to speed with Miden assembly (MASM), please play around with running Miden programs in the [Miden playground](https://playground.miden.xyz).

## Step 1: Initialize your repository

From the parent directory of your `tutorials` clone, create a sibling Cargo project:

```bash
cargo new miden-defi-app
cd miden-defi-app
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Add the following dependencies to your `Cargo.toml` file:

```toml
[dependencies]
# Clone tutorials next to this Cargo project (see Rust client setup).
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.17.2", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.17.2", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.17.1" }
rand = { version = "0.10" }
serde = { version = "1", features = ["derive"] }
serde_json = { version = "1.0", features = ["raw_value"] }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

### Set up your `src/main.rs` file

Copy and paste the following code into your `src/main.rs` file:

```rust no_run
use miden_client::{
    Client, ClientError, Felt, Word, ZERO,
    account::{
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageMapKey, StorageSlot,
        StorageSlotName,
        component::{AccountComponentMetadata, BasicWallet},
    },
    assembly::CodeBuilder,
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient, domain::account::AccountStorageRequirements},
    transaction::{ForeignAccount, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::TutorialClientExt;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};
use std::sync::Arc;

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
            let key = StorageMapKey::new([Felt::new_unchecked(index), ZERO, ZERO, ZERO].into());
            let publisher_word = storage
                .get_map_item(&publishers_slot, key)
                .expect("publisher entry missing from oracle storage");
            // The publisher id word is laid out as [prefix, suffix, 0, 0].
            AccountId::new_unchecked([publisher_word[0], publisher_word[1]])
        })
        .collect();

    // Each publisher exposes its price entries in the `entries` map, keyed by
    // the faucet ID word of the trading pair.
    let entries_slot = StorageSlotName::new("pragma::publisher::entries").expect("valid slot name");
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
        .map(|index| StorageMapKey::new([Felt::new_unchecked(index), ZERO, ZERO, ZERO].into()))
        .collect();
    foreign_accounts.push(ForeignAccount::public(
        oracle_account_id,
        AccountStorageRequirements::new([(publishers_slot.clone(), publisher_index_keys.iter())]),
    )?);

    client.sync_state().await?;

    Ok(foreign_accounts)
}

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // -------------------------------------------------------------------------
    // Initialize Client
    // -------------------------------------------------------------------------
    let network = TutorialNetwork::from_env()?;
    let endpoint = network.endpoint();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(VerifyingRpcClient::new(GrpcClient::new(
        &endpoint, timeout_ms,
    )));

    let keystore_path = std::path::PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = std::path::PathBuf::from("./store.sqlite3");

    let mut client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await?;

    println!("Latest block: {}", client.sync_state().await?.block_num);
    let fee_config = FeeConfig::from_client(&client, network).await?;

    // -------------------------------------------------------------------------
    // Get all foreign accounts for oracle data
    // -------------------------------------------------------------------------
    // Pass a compatible oracle account ID and its `get_median` procedure root as CLI
    // arguments (or through the matching environment variables). This tutorial remains skipped
    // by default because its procedure root depends on the external deployment.
    let oracle_bech32 = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("MIDEN_ORACLE_ACCOUNT_ID").ok())
        .ok_or_else(|| ClientError::Observer(Box::new(std::io::Error::other(
            "Oracle deployment is required: set MIDEN_ORACLE_ACCOUNT_ID and MIDEN_ORACLE_GET_MEDIAN_ROOT for the selected network. Use a compatible v0.17 deployment on the selected network.",
        ))))?;
    let get_median_proc_root = std::env::args()
        .nth(2)
        .or_else(|| std::env::var("MIDEN_ORACLE_GET_MEDIAN_ROOT").ok())
        .ok_or_else(|| {
            ClientError::Observer(Box::new(std::io::Error::other(
            "Set MIDEN_ORACLE_GET_MEDIAN_ROOT to the deployed oracle's get_median procedure root",
        )))
        })?;
    let (account_network, oracle_account_id) = AccountId::from_bech32(&oracle_bech32).unwrap();
    assert_eq!(
        account_network,
        network.network_id(),
        "oracle account must match the selected tutorial network"
    );

    // The published v0.17 deployment identifies BTC/USD by the pair `1:0`. Override
    // either value with the optional third and fourth CLI arguments for the selected deployment.
    // The faucet ID word is laid out as [0, 0, suffix, prefix].
    let pair_prefix: u64 = std::env::args()
        .nth(3)
        .map_or(1, |value| value.parse().expect("pair prefix must be a u64"));
    let pair_suffix: u64 = std::env::args()
        .nth(4)
        .map_or(0, |value| value.parse().expect("pair suffix must be a u64"));
    let btc_usd_pair: Word = [
        ZERO,
        ZERO,
        Felt::new_unchecked(pair_suffix),
        Felt::new_unchecked(pair_prefix),
    ]
    .into();
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
    let contract_code = std::fs::read_to_string("../tutorials/masm/accounts/oracle_reader.masm")
        .unwrap()
        .replace("{get_median_proc_root}", &get_median_proc_root)
        .replace(
            "{oracle_id_prefix}",
            &oracle_account_id.prefix().to_string(),
        )
        .replace(
            "{oracle_id_suffix}",
            &oracle_account_id.suffix().to_string(),
        )
        .replace("{pair_prefix}", &pair_prefix.to_string())
        .replace("{pair_suffix}", &pair_suffix.to_string());

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
        AccountComponentMetadata::new("external_contract::oracle_reader"),
    )
    .unwrap();

    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    let oracle_reader_contract = AccountBuilder::new(seed)
        .account_type(AccountType::Public)
        .with_component(contract_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build()
        .unwrap();

    client
        .add_account(&oracle_reader_contract, false)
        .await
        .unwrap();
    fund_account_for_fees(&mut client, oracle_reader_contract.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // Build the script that calls our `get_price` procedure
    // -------------------------------------------------------------------------
    let script_code =
        std::fs::read_to_string("../tutorials/masm/scripts/oracle_reader_script.masm").unwrap();

    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::oracle_reader", &contract_code)
        .unwrap()
        .compile_tx_script(&script_code)
        .unwrap();

    let tx_increment_request = TransactionRequestBuilder::new()
        .foreign_accounts(foreign_accounts)
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(oracle_reader_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await.unwrap();

    Ok(())
}
```

The following section explains the two MASM templates loaded by the Rust example.

In the code above, a compatible testnet oracle account ID and `get_median` procedure root are required inputs. The BTC/USD price feed uses prefix `1` and suffix `0` in Pragma's v0.17 deployment; the optional third and fourth arguments let you supply other published pair identifiers. The `get_oracle_foreign_accounts` function returns every `ForeignAccount` needed to execute the transaction. Since Pragma's oracle aggregates data from multiple publishers, the function reads the on-chain publisher registry and requests the storage proofs needed by the nested FPI calls.

## Step 2: Build the price reader smart contract and script

The reader and transaction script are in the repository’s `masm/` directory.

### Oracle price reader smart contract

Below is our oracle price reader contract. It has a single exported procedure: `get_price`

The `miden::protocol::tx` module exports `execute_foreign_procedure`, which the reader uses to invoke the oracle.

#### Here's a breakdown of what the `get_price` procedure does:

1. Pushes the 16 foreign procedure inputs that `tx::execute_foreign_procedure` requires. The first four contain the requested pair prefix and suffix, an `amount` of `0`, and a trailing `0`; the remaining twelve are zero padding.
2. Pushes the supplied `get_median` procedure root.
3. Pushes the supplied testnet oracle account ID prefix and suffix.
4. Calls `tx::execute_foreign_procedure`, which invokes `get_median`. The template expects `[is_tracked, median_price, amount]` at the top of the returned stack; confirm this interface against the compatible deployment.
5. Drops the sixteen foreign output elements, including the price, to restore the caller's stack.

The reader is defined in `masm/accounts/oracle_reader.masm`:

```masm
# the Rust runner replaces these placeholders with values from a compatible
# pragma deployment before compiling this component.

use miden::protocol::tx

# PUBLIC INTERFACE
# =================================================================================================

#! Queries the configured Pragma oracle's median price through a foreign procedure.
#!
#! Inputs:  [pad(16)]
#! Outputs: [pad(16)]
#!
#! Panics if:
#! - the configured oracle procedure or its required foreign state is unavailable.
#!
#! Invocation: call
@account_procedure
pub proc get_price()
    # `execute_foreign_procedure` requires exactly 16 foreign procedure inputs.
    # `get_median` only reads the first four, so the rest are zero padding.
    padw padw padw
    # => [pad(28)]

    # requested pair: faucet ID prefix/suffix, amount `0`.
    push.0.0.{pair_suffix}.{pair_prefix}
    # => [pair_prefix, pair_suffix, amount, 0, pad(28)]

    # this is the procedure root of the `get_median` procedure.
    push.{get_median_proc_root}
    # => [GET_MEDIAN_HASH, foreign_procedure_inputs(16), pad(16)]

    # the Pragma oracle account id: prefix then suffix, leaving suffix on top.
    push.{oracle_id_prefix}.{oracle_id_suffix}
    # => [oracle_id_suffix, oracle_id_prefix, GET_MEDIAN_HASH, foreign_procedure_inputs(16), pad(16)]

    exec.tx::execute_foreign_procedure
    # => [is_tracked, median_price, amount, pad(29)]

    dropw dropw dropw dropw
    # => [pad(16)]
end
```

Stack comments below instruction groups show the expected stack state after execution. The braces in this template are replaced by Rust before assembly.

### Create the script which calls the `get_price` procedure

This is a Miden assembly script that will call the `get_price` procedure during the transaction.

The transaction script is defined in `masm/scripts/oracle_reader_script.masm`:

```masm
use external_contract::oracle_reader

#! Queries the configured oracle through the reader account.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    call.oracle_reader::get_price
    # => [pad(16)]
end
```

## Step 3: Run the program

Compile-check the standalone program with `cargo check`. The following configuration was verified on testnet on October 8, 2026. If Pragma upgrades its deployment, update the account ID and procedure root before running:

```bash
export MIDEN_ORACLE_ACCOUNT_ID=mtst1aqxnneud7y34z5gwc5z8vu95pcsdmcxm
export MIDEN_ORACLE_GET_MEDIAN_ROOT=0xf719938d260c27f237216077dfa15125678bbdbc3a00e631a8e6abecc9d20d97
```

Then run the standalone program:

```bash
TUTORIAL_NETWORK=testnet cargo run --release -- \
  "$MIDEN_ORACLE_ACCOUNT_ID" "$MIDEN_ORACLE_GET_MEDIAN_ROOT"
```

The command defaults to the BTC/USD pair prefix `1` and suffix `0`. Append the deployment's pair prefix and suffix as the third and fourth arguments when querying another pair.

With a compatible deployment, the output includes:

```text
Latest block: <block_number>
Oracle accountId prefix: <oracle_prefix> suffix: <oracle_suffix>
View transaction on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>
```

The template expects `[is_tracked, median_price, amount]` on the stack, then drops those values. Before using the price in an application, check the feed's tracking status, freshness rules, and fixed-point precision, then store the value or use it within the same procedure.

### Running the tutorial

Once the deployment prerequisites are met, return to the root of the [tutorials repository](https://github.com/0xMiden/tutorials/) and run:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin oracle_data_query -- \
  "$MIDEN_ORACLE_ACCOUNT_ID" "$MIDEN_ORACLE_GET_MEDIAN_ROOT"
```

If both variables are exported in your shell, you can omit `--` and the explicit arguments. The account must use the `mtst1...` testnet prefix.

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](./unauthenticated_note_how_to.md)
