use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::time::sleep;

use miden_client::{
    account::{
        component::{AccountComponentMetadata, BasicWallet},
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{domain::account::AccountStorageRequirements, GrpcClient, VerifyingRpcClient},
    transaction::{ForeignAccount, TransactionRequestBuilder},
    ClientError, Word,
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
    // STEP 1: Create the Count Reader Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating count reader contract.");

    // `include_str!` resolves at compile time relative to this source file,
    // so the binary is independent of the working directory it is run from.
    let count_reader_code = include_str!("../../../masm/accounts/count_reader.masm");

    let count_reader_slot_name =
        StorageSlotName::new("miden::tutorials::count_reader").expect("valid slot name");
    let count_reader_component_code = client
        .code_builder()
        .compile_component_code(
            "external_contract::count_reader_contract",
            count_reader_code,
        )
        .unwrap();
    let count_reader_component = AccountComponent::new(
        count_reader_component_code,
        vec![StorageSlot::with_value(
            count_reader_slot_name.clone(),
            Word::default(),
        )],
        AccountComponentMetadata::new("external_contract::count_reader_contract"),
    )
    .unwrap();

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let count_reader_contract = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(count_reader_component.clone())
        .with_component(BasicWallet)
        .with_component(NoAuth)
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
    fund_account_for_fees(&mut client, count_reader_contract.id(), &fee_config).await?;

    // -------------------------------------------------------------------------
    // STEP 2: Build & Get State of the Counter Contract
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Building counter contract from public state");

    // Pass the account ID printed by `counter_contract_deploy` as the first argument, or via
    // `MIDEN_COUNTER_ACCOUNT_ID`.
    let counter_contract_bech32 = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("MIDEN_COUNTER_ACCOUNT_ID").ok())
        .expect("pass the counter account ID from counter_contract_deploy");
    let (account_network, counter_contract_id) =
        AccountId::from_bech32(&counter_contract_bech32).expect("invalid counter account ID");
    assert_eq!(
        account_network,
        network.network_id(),
        "counter account must match the selected tutorial network"
    );

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

    // Link the local counter module so the MASM script can resolve
    // `procref.counter_contract::get_count` directly.
    let counter_contract_code = include_str!("../../../masm/accounts/counter.masm");

    println!("counter id prefix: {:?}", counter_contract_id.prefix());
    println!("counter id suffix: {:?}", counter_contract_id.suffix());

    let script_code = include_str!("../../../masm/scripts/reader_script.masm")
        .replace(
            "{account_id_suffix}",
            &counter_contract_id.suffix().as_canonical_u64().to_string(),
        )
        .replace(
            "{account_id_prefix}",
            &u64::from(counter_contract_id.prefix()).to_string(),
        );

    // Link both modules into the same `CodeBuilder` chain that compiles the
    // script. This lets MASM resolve the `procref` without formatting a
    // procedure digest into the source string at runtime.
    let tx_script = client
        .code_builder()
        .with_linked_module(
            "external_contract::count_reader_contract",
            count_reader_code,
        )
        .unwrap()
        .with_linked_module("external_contract::counter_contract", counter_contract_code)
        .unwrap()
        .compile_tx_script(script_code.as_str())
        .unwrap();

    let foreign_account =
        ForeignAccount::public(counter_contract_id, AccountStorageRequirements::default()).unwrap();

    let tx_request = TransactionRequestBuilder::new()
        .foreign_accounts([foreign_account])
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(count_reader_contract.id(), tx_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
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
    assert_eq!(
        account_2
            .storage()
            .get_item(&count_reader_slot_name)
            .unwrap(),
        account_1.storage().get_item(&counter_slot_name).unwrap(),
        "FPI must copy the current counter value",
    );

    Ok(())
}
