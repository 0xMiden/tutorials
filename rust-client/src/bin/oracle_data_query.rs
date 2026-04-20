use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageMapKey, StorageSlot, StorageSlotName,
        StorageSlotType,
    },
    assembly::CodeBuilder,
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{
        domain::account::AccountStorageRequirements,
        Endpoint, GrpcClient,
    },
    transaction::{ForeignAccount, TransactionRequestBuilder},
    Client, ClientError, Word,
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
    trading_pair: u64,
) -> Result<Vec<ForeignAccount>, ClientError> {
    client.import_account_by_id(oracle_account_id).await?;

    let oracle_record = client
        .get_account(oracle_account_id)
        .await
        .expect("RPC failed")
        .expect("oracle account not found");

    let storage = oracle_record.storage();
    let publisher_count_slot = storage
        .slots()
        .iter()
        .find(|slot| {
            let name = slot.name().as_str();
            name.contains("publisher") && name.contains("count")
        })
        .map(|slot| slot.name().clone())
        .or_else(|| storage.slots().first().map(|slot| slot.name().clone()))
        .expect("oracle storage is expected to have at least one slot");

    let publisher_count = storage
        .get_item(&publisher_count_slot)
        .map(|word| word[0].as_canonical_u64())
        .unwrap_or(0);

    let publisher_id_slots: Vec<StorageSlotName> = storage
        .slots()
        .iter()
        .filter(|slot| slot.slot_type() == StorageSlotType::Value)
        .filter(|slot| slot.name() != &publisher_count_slot)
        .map(|slot| slot.name().clone())
        .collect();

    let publisher_ids: Vec<AccountId> = publisher_id_slots
        .iter()
        .take(publisher_count.saturating_sub(1) as usize)
        .filter_map(|slot_name| storage.get_item(slot_name).ok())
        .map(|digest| {
            let words: Word = digest.into();
            AccountId::new_unchecked([words[3], words[2]])
        })
        .collect();

    let mut foreign_accounts = Vec::with_capacity(publisher_ids.len() + 1);
    let empty_keys: [StorageMapKey; 0] = [];

    for pid in publisher_ids {
        client.import_account_by_id(pid).await?;

        let publisher_record = client
            .get_account(pid)
            .await
            .expect("RPC failed")
            .expect("publisher account not found");
        let map_slot_names: Vec<StorageSlotName> = publisher_record
            .storage()
            .slots()
            .iter()
            .filter(|slot| slot.slot_type() == StorageSlotType::Map)
            .map(|slot| slot.name().clone())
            .collect();

        let storage_requirements = AccountStorageRequirements::new(
            map_slot_names
                .iter()
                .map(|slot_name| (slot_name.clone(), empty_keys.iter())),
        );

        foreign_accounts.push(ForeignAccount::public(pid, storage_requirements)?);
    }

    foreign_accounts.push(ForeignAccount::public(
        oracle_account_id,
        AccountStorageRequirements::default(),
    )?);

    Ok(foreign_accounts)
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
    let btc_usd_pair_id = 120195681;
    let foreign_accounts: Vec<ForeignAccount> =
        get_oracle_foreign_accounts(&mut client, oracle_account_id, btc_usd_pair_id).await?;

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

    let tx_script = client
        .code_builder()
        .with_dynamically_linked_library(contract_component.component_code())
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
