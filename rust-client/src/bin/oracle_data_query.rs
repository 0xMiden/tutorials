use miden_client::{
    account::{
        component::{AccountComponentMetadata, BasicWallet},
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageMapKey, StorageSlot,
        StorageSlotName,
    },
    assembly::CodeBuilder,
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{domain::account::AccountStorageRequirements, GrpcClient, VerifyingRpcClient},
    transaction::{ForeignAccount, TransactionRequestBuilder},
    Client, ClientError, Felt, Word, ZERO,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::Rng;
use rust_client::TutorialClientExt;
use rust_client::{fund_account_for_fees, FeeConfig, TutorialNetwork};
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
    let contract_code = include_str!("../../../masm/accounts/oracle_reader.masm")
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
    let script_code = include_str!("../../../masm/scripts/oracle_reader_script.masm");

    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::oracle_reader", &contract_code)
        .unwrap()
        .compile_tx_script(script_code)
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

    Ok(())
}
