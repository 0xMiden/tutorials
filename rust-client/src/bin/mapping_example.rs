use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::{AccountComponentMetadata, BasicWallet},
        AccountBuilder, AccountComponent, AccountType, StorageMap, StorageMapKey, StorageSlot,
        StorageSlotName,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
    ClientError,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rust_client::{fund_account_for_fees, FeeConfig, TutorialNetwork};

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

    // Load the MASM file for the mapping contract. `include_str!` resolves at
    // compile time relative to this source file.
    let account_code = include_str!("../../../masm/accounts/mapping_example_contract.masm");

    // Storage slots are named in v0.17; the component only needs its mapping slot.
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
        vec![storage_slot_map],
        AccountComponentMetadata::new("miden_by_example::mapping_example_contract"),
    )
    .unwrap();

    // Init seed for the counter contract
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

    let script_code = include_str!("../../../masm/scripts/mapping_example_script.masm");

    // Compile the transaction script with the account code linked as a
    // module on the same `CodeBuilder` chain.
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
