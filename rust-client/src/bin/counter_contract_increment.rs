use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{AccountId, StorageSlotName},
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{Endpoint, GrpcClient},
    transaction::TransactionRequestBuilder,
    ClientError,
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
    // STEP 1: Read the Public State of the Counter Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Reading data from public state");

    // Define the Counter Contract account id from counter contract deploy
    let (_, counter_contract_id) =
        AccountId::from_bech32("mtst1apsd609q5966cqra992t4a00tgstrkfk").unwrap();

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
    // STEP 2: Call the Counter Contract with a script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call the increment_count procedure in the counter contract");

    // Load the MASM sources at compile time so the binary is independent of
    // the working directory it is run from.
    let script_code = include_str!("../../../masm/scripts/counter_script.masm");
    let counter_code = include_str!("../../../masm/accounts/counter.masm");

    // Compile the script with the counter contract code linked as a module
    // on the same `CodeBuilder` chain.
    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::counter_contract", counter_code)
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
        .submit_new_transaction(counter_contract_id, tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();

    // Retrieve updated contract data to see the incremented counter
    let account = client
        .get_account(counter_contract_id)
        .await
        .unwrap()
        .expect("counter contract not found");
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    println!(
        "counter contract storage: {:?}",
        account.storage().get_item(&counter_slot_name)
    );
    Ok(())
}
