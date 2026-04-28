use rand::RngCore;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent,
        AccountStorageMode, AccountType, StorageSlot, StorageSlotName,
    },
    address::NetworkId,
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{Endpoint, GrpcClient},
    transaction::TransactionRequestBuilder,
    ClientError, Word,
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
    // STEP 1: Create a basic counter contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating counter contract.");

    // Load the MASM file for the counter contract. `include_str!` resolves at
    // compile time relative to this source file, so the binary is independent
    // of the working directory it is run from.
    let counter_code = include_str!("../../../masm/accounts/counter.masm");

    // Compile the account code into `AccountComponent` with one storage slot.
    // Using `client.code_builder()` makes the assembler share the client's
    // persisted source manager, which keeps debug spans coherent for any
    // libraries that link against this code later (see miden-vm#2778).
    let counter_slot_name =
        StorageSlotName::new("miden::tutorials::counter").expect("valid slot name");
    let component_code = client
        .code_builder()
        .compile_component_code("external_contract::counter_contract", counter_code)
        .unwrap();
    let counter_component = AccountComponent::new(
        component_code,
        vec![StorageSlot::with_value(
            counter_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::counter_contract", AccountType::all()),
    )
    .unwrap();

    // Init seed for the counter contract
    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    // Build the new `Account` with the component
    let counter_contract = AccountBuilder::new(seed)
        .account_type(AccountType::RegularAccountImmutableCode)
        .storage_mode(AccountStorageMode::Public)
        .with_component(counter_component.clone())
        .with_auth_component(NoAuth)
        .build()
        .unwrap();

    println!(
        "counter_contract commitment: {:?}",
        counter_contract.to_commitment()
    );
    println!("counter_contract id: {:?}", counter_contract.id());
    println!("counter_contract storage: {:?}", counter_contract.storage());

    client.add_account(&counter_contract, false).await.unwrap();

    // -------------------------------------------------------------------------
    // STEP 2: Call the Counter Contract with a script
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Call Counter Contract With Script");

    // Load the MASM script referencing the increment procedure
    let script_code = include_str!("../../../masm/scripts/counter_script.masm");

    // Compile the script with the counter contract code linked as a dynamic
    // module on the same `CodeBuilder`. This shares the client's source
    // manager between parsing and assembly, which is what miden-vm#2778
    // requires to avoid panics when debug spans are reported.
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
        .submit_new_transaction(counter_contract.id(), tx_increment_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    println!(
        "Counter contract id: {:?}",
        counter_contract.id().to_bech32(NetworkId::Testnet)
    );

    client.sync_state().await.unwrap();

    // Retrieve updated contract data to see the incremented counter
    let account = client
        .get_account(counter_contract.id())
        .await
        .unwrap()
        .expect("counter contract not found");
    println!(
        "counter contract storage: {:?}",
        account.storage().get_item(&counter_slot_name)
    );

    Ok(())
}
