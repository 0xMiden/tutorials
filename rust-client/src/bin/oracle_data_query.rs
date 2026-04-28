use miden_client::{
    account::{
        component::AccountComponentMetadata, AccountBuilder, AccountComponent, AccountId,
        AccountStorageMode, AccountType, StorageMapKey, StorageSlot, StorageSlotName,
    },
    auth::NoAuth,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{
        domain::account::AccountStorageRequirements,
        Endpoint, GrpcClient,
    },
    transaction::{ForeignAccount, TransactionRequestBuilder},
    Client, ClientError, Felt, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use std::{path::PathBuf, sync::Arc};

// BTC/USD pair encoding per `astraly-labs/pragma-miden`.
const PAIR_PREFIX: u64 = 1;
const PAIR_SUFFIX: u64 = 0;

// Pragma oracle storage slot names. Match the constants in
// `astraly-labs/pragma-miden/crates/accounts/src/oracle/oracle.masm`
// and `publisher/publisher.masm`.
const SLOT_NEXT_INDEX: &str = "pragma::oracle::next_publisher_index";
const SLOT_PUBLISHERS: &str = "pragma::oracle::publishers";
const SLOT_ENTRIES: &str = "pragma::publisher::entries";

// Procedure root of the `get_median` procedure on the deployed Pragma oracle
// contract. DEPLOYMENT-SPECIFIC: this hash must be re-verified after every
// Pragma redeploy. Source of truth:
// https://github.com/astraly-labs/pragma-miden#deployments
const GET_MEDIAN_PROC_HASH: &str =
    "0xb86237a8c9cd35acfef457e47282cc4da43df676df410c988eab93095d8fb3b9";

/// Walks the Pragma oracle's storage to import the oracle and all of its
/// publisher accounts as `ForeignAccount`s. Each publisher's
/// `pragma::publisher::entries` map is gated on the supplied `pair_word`,
/// so the returned foreign-account list only proves what's needed to read
/// that single trading pair via FPI.
///
/// `pair_word` is a 4-element Word `[prefix, suffix, 0, 0]`. For BTC/USD
/// per Pragma's convention, build it from `PAIR_PREFIX = 1, PAIR_SUFFIX = 0`.
///
/// Mirrors the walk pattern in
/// `astraly-labs/pragma-miden/examples/consume-price/src/main.rs`.
pub async fn get_oracle_foreign_accounts(
    client: &mut Client<FilesystemKeyStore>,
    oracle_account_id: AccountId,
    pair_word: Word,
) -> Result<Vec<ForeignAccount>, ClientError> {
    client.import_account_by_id(oracle_account_id).await?;
    println!("Imported oracle account: {}", oracle_account_id);

    let oracle = client
        .get_account(oracle_account_id)
        .await?
        .expect("oracle account not found");
    let storage = oracle.storage();

    let count_slot = StorageSlotName::new(SLOT_NEXT_INDEX).expect("valid slot name");
    let publishers_slot = StorageSlotName::new(SLOT_PUBLISHERS).expect("valid slot name");
    let entries_slot = StorageSlotName::new(SLOT_ENTRIES).expect("valid slot name");

    let publisher_count = storage.get_item(&count_slot)?[0].as_canonical_u64();
    let pair_key = StorageMapKey::new(pair_word);

    // Pragma reserves indices 0 and 1 as sentinels; real publishers start at 2.
    let mut foreign_accounts = Vec::with_capacity(publisher_count.saturating_sub(2) as usize + 1);
    for i in 2..publisher_count {
        let key: Word = [Felt::new(i), Felt::ZERO, Felt::ZERO, Felt::ZERO].into();
        let w: Word = storage.get_map_item(&publishers_slot, key)?;
        // The publisher record stores `[suffix, prefix, ...]` at indices [2..3].
        let pid = AccountId::new_unchecked([w[3], w[2]]);

        client.import_account_by_id(pid).await?;
        foreign_accounts.push(ForeignAccount::public(
            pid,
            AccountStorageRequirements::new([(entries_slot.clone(), [pair_key].iter())]),
        )?);
    }

    foreign_accounts.push(ForeignAccount::public(
        oracle_account_id,
        AccountStorageRequirements::default(),
    )?);

    Ok(foreign_accounts)
}

/// Fills the `oracle_reader.masm` template with deployment-specific values.
fn oracle_reader_source(oracle_id: AccountId) -> String {
    include_str!("../../../masm/accounts/oracle_reader.masm")
        .replace("{pair_prefix}", &PAIR_PREFIX.to_string())
        .replace("{pair_suffix}", &PAIR_SUFFIX.to_string())
        .replace("{get_median_proc_hash}", GET_MEDIAN_PROC_HASH)
        .replace("{oracle_id_prefix}", &u64::from(oracle_id.prefix()).to_string())
        .replace(
            "{oracle_id_suffix}",
            &oracle_id.suffix().as_canonical_u64().to_string(),
        )
}

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    // -------------------------------------------------------------------------
    // Initialize Client
    // -------------------------------------------------------------------------
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

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

    println!("Latest block: {}", client.sync_state().await?.block_num);

    // -------------------------------------------------------------------------
    // Parse and validate oracle account ID from CLI
    // -------------------------------------------------------------------------
    // The Pragma oracle account ID is read from the first CLI argument and
    // accepted in either bech32 (`mtst1...`) or hex (`0x...`) form via
    // `AccountId::parse`. Live IDs rotate per testnet iteration; the
    // canonical source is the `astraly-labs/pragma-miden` README:
    //   https://github.com/astraly-labs/pragma-miden#deployments
    // Run as:
    //   cargo run --release --bin oracle_data_query -- <ORACLE_ACCOUNT_ID>
    let oracle_arg = std::env::args().nth(1).expect(
        "Usage: oracle_data_query <ORACLE_ACCOUNT_ID> -- pass the current testnet oracle ID from https://github.com/astraly-labs/pragma-miden#deployments",
    );
    let (oracle_account_id, _network) =
        AccountId::parse(&oracle_arg).expect("Invalid account ID format (expected bech32 or hex)");
    println!(
        "Parsed oracle ID: prefix={}, suffix={}",
        u64::from(oracle_account_id.prefix()),
        oracle_account_id.suffix().as_canonical_u64(),
    );

    // -------------------------------------------------------------------------
    // Build & locally compile the oracle reader contract + script
    // -------------------------------------------------------------------------
    // We do this BEFORE walking publishers so that a dead Pragma oracle does
    // not block local verification of the template substitution and the MASM
    // assembly. If anything below panics or fails to compile, the bug is in
    // our code; if it succeeds and only the publisher walk fails, the bug is
    // upstream (Pragma deployment availability).
    let contract_code: String = oracle_reader_source(oracle_account_id);

    // Defensive gate: if any placeholder was missed, fail loudly here rather
    // than letting the MASM assembler emit an opaque parse error. The braces
    // `{` / `}` only appear in oracle_reader.masm as template tokens.
    if let Some(bad) = contract_code
        .lines()
        .find(|l| l.contains('{') || l.contains('}'))
    {
        panic!(
            "oracle_reader template substitution incomplete; offending line: `{}`",
            bad.trim()
        );
    }
    println!("oracle_reader template substituted (no leftover placeholders)");

    let contract_slot_name =
        StorageSlotName::new("miden::tutorials::oracle_reader").expect("valid slot name");
    let contract_component_code = client
        .code_builder()
        .compile_component_code("external_contract::oracle_reader", contract_code.as_str())
        .unwrap();
    println!("Compiled oracle_reader component locally");

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
    // Compile the script that calls our `get_price` procedure
    // -------------------------------------------------------------------------
    let script_code = include_str!("../../../masm/scripts/oracle_reader_script.masm");

    // Link the oracle reader contract code into the same `CodeBuilder` chain
    // that compiles the script, so the assembler shares the client's
    // persisted source manager (avoids the source-span mismatch from
    // miden-vm#2778).
    let tx_script = client
        .code_builder()
        .with_linked_module("external_contract::oracle_reader", contract_code.as_str())
        .unwrap()
        .compile_tx_script(script_code)
        .unwrap();
    println!("Compiled tx_script with linked oracle_reader module");

    // -------------------------------------------------------------------------
    // Walk Pragma's storage to import the oracle + publishers (BTC/USD pair)
    // -------------------------------------------------------------------------
    // This is the FIRST step that depends on a live Pragma deployment. If
    // Pragma is on a different miden-protocol version than this tutorial, or
    // if Pragma's accounts have been redeployed without updating the IDs, this
    // call will fail with `AccountNotFoundOnChain`. The local compile above
    // proves the template + MASM path is healthy independent of that.
    let pair_word: Word = [
        Felt::new(PAIR_PREFIX),
        Felt::new(PAIR_SUFFIX),
        Felt::ZERO,
        Felt::ZERO,
    ]
    .into();
    let foreign_accounts: Vec<ForeignAccount> =
        get_oracle_foreign_accounts(&mut client, oracle_account_id, pair_word).await?;

    let tx_request = TransactionRequestBuilder::new()
        .foreign_accounts(foreign_accounts)
        .custom_script(tx_script)
        .build()
        .unwrap();

    let tx_id = client
        .submit_new_transaction(oracle_reader_contract.id(), tx_request)
        .await
        .unwrap();

    println!(
        "View transaction on MidenScan: https://testnet.midenscan.com/tx/{:?}",
        tx_id
    );

    client.sync_state().await.unwrap();

    Ok(())
}
