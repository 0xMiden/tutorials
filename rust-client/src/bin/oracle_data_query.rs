use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountType, StorageMapKey, StorageSlot, StorageSlotName,
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
            let key: Word = [Felt::new_unchecked(index), ZERO, ZERO, ZERO].into();
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
        .map(|index| StorageMapKey::new([Felt::new_unchecked(index), ZERO, ZERO, ZERO].into()))
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
        [ZERO, ZERO, Felt::new_unchecked(pair_suffix), Felt::new_unchecked(pair_prefix)].into();
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
        AccountComponentMetadata::new("external_contract::oracle_reader"),
    )
    .unwrap();

    let mut seed = [0_u8; 32];
    client.rng().fill_bytes(&mut seed);

    let oracle_reader_contract = AccountBuilder::new(seed)
        .account_type(AccountType::Public)
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
