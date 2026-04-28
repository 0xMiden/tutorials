use rand::RngCore;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent,
        AccountStorageMode, AccountType, StorageMap, StorageSlot, StorageSlotName,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{Endpoint, GrpcClient},
    transaction::TransactionRequestBuilder,
    ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // Initialize client
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    // Initialize keystore
    let keystore_path = PathBuf::from("./keystore");
    let keystore = Arc::new(FilesystemKeyStore::new(keystore_path).unwrap());

    let store_path = PathBuf::from("./store.sqlite3");

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
    // STEP 1: Deploy a smart contract with a mapping
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Deploy a smart contract with a mapping");

    // Load the MASM file for the counter contract. `include_str!` resolves at
    // compile time relative to this source file.
    let account_code = include_str!("../../../masm/accounts/mapping_example_contract.masm");

    // Using an empty storage value in slot 0 since this is usually reserved
    // for the account pub_key and metadata
    let empty_slot_name =
        StorageSlotName::new("miden::tutorials::mapping::value").expect("valid slot name");
    let empty_storage_slot = StorageSlot::with_value(empty_slot_name.clone(), Word::default());

    // initialize storage map
    let storage_map = StorageMap::new();
    let map_slot_name =
        StorageSlotName::new("miden::tutorials::mapping::map").expect("valid slot name");
    let storage_slot_map = StorageSlot::with_map(map_slot_name.clone(), storage_map.clone());

    // Compile the account code into `AccountComponent` with one storage slot
    let component_code = client
        .code_builder()
        .compile_component_code("miden_by_example::mapping_example_contract", account_code)
        .unwrap();
    let mapping_contract_component = AccountComponent::new(
        component_code,
        vec![empty_storage_slot, storage_slot_map],
        AccountComponentMetadata::new("miden_by_example::mapping_example_contract", AccountType::all()),
    )
    .unwrap();

    // Init seed for the counter contract
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Build the new `Account` with the component
    let mapping_example_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(mapping_contract_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    client
        .add_account(&mapping_example_contract, false)
        .await
        .unwrap();

    // -------------------------------------------------------------------------
    // STEP 2: Call the Mapping Contract with a Script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call Mapping Contract With Script");

    let script_code = include_str!("../../../masm/scripts/mapping_example_script.masm");

    // Compile the transaction script with the account code linked as a
    // module on the same `CodeBuilder` chain (avoids the source-span
    // mismatch from miden-vm#2778).
    let tx_script = client
        .code_builder()
        .with_linked_module("miden_by_example::mapping_example_contract", account_code)
        .unwrap()
        .compile_tx_script(script_code)
        .unwrap();

    // Build a transaction request with the custom script
    let tx_increment_request = TransactionRequestBuilder::new()
        .custom_script(tx_script)
        .build()
        .unwrap();

    // Execute and submit the transaction
    let tx_id = client
        .submit_new_transaction(mapping_example_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();

    let account = client
        .get_account(mapping_example_contract.id())
        .await
        .unwrap()
        .expect("mapping contract not found");
    let key = [Felt::new(0), Felt::new(0), Felt::new(0), Felt::new(0)].into();
    println!(
        "Mapping state\n Index: {:?}\n Key: {:?}\n Value: {:?}",
        map_slot_name,
        key,
        account.storage().get_map_item(&map_slot_name, key)
    );

    Ok(())
}
