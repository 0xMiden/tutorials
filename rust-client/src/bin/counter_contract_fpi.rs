use rand::RngCore;
use std::{fs, path::Path, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageSlot, StorageSlotName,
    },
    assembly::CodeBuilder,
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{domain::account::AccountStorageRequirements, Endpoint, GrpcClient},
    transaction::{ForeignAccount, TransactionRequestBuilder},
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
        AccountId::from_bech32("mtst1az2nu8k3jwtzvqzvpjdp45dn3qrmdgzx").unwrap();

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

    let tx_script = client
        .code_builder()
        .with_dynamically_linked_library(count_reader_component.component_code())
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
