//! Common helper functions for scripts and tests

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{bail, Context, Result};
use miden_client::{
    account::{
        component::{BasicWallet, InitStorageData},
        Account, AccountBuilder, AccountComponent, AccountType,
    },
    auth::{AuthSecretKey, AuthSingleSig, NoAuth},
    builder::ClientBuilder,
    crypto::{FeltRng, RandomCoin},
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteAssets, NoteScript, NoteTag, NoteType},
    rpc::{Endpoint, GrpcClient},
    transaction::TransactionScript,
    utils::Deserializable,
    Client, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::assembly::Package;
use miden_standards::testing::note::NoteBuilder;
use rand::Rng;

/// Test setup configuration containing initialized client and keystore
pub struct ClientSetup {
    /// The configured Miden client instance.
    pub client: Client<FilesystemKeyStore>,
    /// The filesystem-backed keystore used by the client.
    pub keystore: Arc<FilesystemKeyStore>,
}

/// Initializes test infrastructure with client and keystore.
pub async fn setup_client() -> Result<ClientSetup> {
    let endpoint = Endpoint::testnet();
    let timeout_ms = 10_000;
    let rpc_client = Arc::new(GrpcClient::new(&endpoint, timeout_ms));

    let keystore_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../keystore");
    let keystore =
        Arc::new(FilesystemKeyStore::new(keystore_path).context("Failed to initialize keystore")?);

    let store_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../store.sqlite3");

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .build()
        .await
        .context("Failed to build Miden client")?;

    Ok(ClientSetup { client, keystore })
}

/// Builds a Miden project with the `miden` CLI installed by midenup and returns its [`Package`].
/// `CARGO_MIDEN` can select a standalone cargo-miden binary instead.
pub fn build_project_in_dir(dir: &Path, release: bool) -> Result<Package> {
    // Parallel tests share the compiled package paths. Hold the lock through
    // deserialization so another build cannot replace an artifact while it is read.
    static BUILD_LOCK: Mutex<()> = Mutex::new(());
    let _guard = BUILD_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Miden build lock poisoned"))?;
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(dir);
    let profile_dir = if release { "release" } else { "dev" };
    let mut command = match std::env::var_os("CARGO_MIDEN") {
        Some(binary) => {
            let mut command = std::process::Command::new(binary);
            command.arg("miden");
            command
        }
        None => std::process::Command::new("miden"),
    };
    command
        .arg("build")
        .current_dir(&dir)
        .env_remove("CARGO_TARGET_DIR")
        .env_remove("RUSTUP_TOOLCHAIN")
        .env_remove("CARGO")
        .env_remove("RUSTC")
        .env_remove("RUSTDOC");
    if release {
        command.arg("--release");
    }
    let status = command
        .status()
        .context("Failed to run Miden contract build")?;
    if !status.success() {
        bail!("Miden contract build failed with {status}");
    }
    let artifact_dir = dir.join("target/miden").join(profile_dir);
    let mut artifacts = std::fs::read_dir(&artifact_dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "masp"));
    let artifact_path = artifacts
        .next()
        .context("Miden contract build produced no MASP artifact")?;
    if artifacts.next().is_some() {
        bail!("expected one MASP artifact in {}", artifact_dir.display());
    }

    let package_bytes = std::fs::read(&artifact_path).context(format!(
        "Failed to read compiled package from {}",
        artifact_path.display()
    ))?;
    Package::read_from_bytes(&package_bytes).context("Failed to deserialize package from bytes")
}

/// Loads the procedure marked `@transaction_script` from a compiled package.
pub fn build_tx_script_from_package(package: &Package) -> Result<TransactionScript> {
    TransactionScript::from_package(package).context("Failed to load transaction script")
}

/// Configuration for creating an account with a custom component.
pub struct AccountCreationConfig {
    /// The account type to create. In protocol v0.16 this also encodes the
    /// storage visibility (`AccountType::Public` / `AccountType::Private`).
    pub account_type: AccountType,
    /// Initial component storage data keyed by storage slot schema.
    pub init_storage_data: InitStorageData,
}

impl Default for AccountCreationConfig {
    fn default() -> Self {
        Self {
            account_type: AccountType::Public,
            init_storage_data: InitStorageData::default(),
        }
    }
}

/// Creates an account component from a compiled package.
pub fn account_component_from_package(
    package: Arc<Package>,
    config: &AccountCreationConfig,
) -> Result<AccountComponent> {
    AccountComponent::from_package(package.as_ref(), &config.init_storage_data)
        .context("Failed to create account component from package")
}

/// Creates an owner-authenticated account with a custom component from a compiled package.
pub async fn create_account_from_package(
    client: &mut Client<FilesystemKeyStore>,
    keystore: Arc<FilesystemKeyStore>,
    package: Arc<Package>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let account_component = account_component_from_package(package, &config)?;

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);
    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let account = AccountBuilder::new(init_seed)
        .account_type(config.account_type)
        .with_component(account_component)
        .with_component(BasicWallet)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .build()
        .context("Failed to build account")?;

    println!("Account ID: {:?}", account.id());

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    keystore
        .add_key(&key_pair, account.id())
        .await
        .context("Failed to add bank owner key to keystore")?;

    Ok(account)
}

/// Creates an existing account with NoAuth for isolated MockChain tests only.
pub fn create_testing_account_from_package(
    package: Arc<Package>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let account_component = account_component_from_package(package, &config)?;

    let account = AccountBuilder::new([3u8; 32])
        .account_type(config.account_type)
        .with_component(account_component)
        .with_component(BasicWallet)
        .with_component(NoAuth)
        .build_existing()
        .context("Failed to build account")?;

    Ok(account)
}

/// Configuration for creating a note.
pub struct NoteCreationConfig {
    /// The note visibility type.
    pub note_type: NoteType,
    /// The note tag to attach to the metadata.
    pub tag: NoteTag,
    /// Assets to include in the note.
    pub assets: NoteAssets,
    /// Storage (note inputs) passed to the note script.
    pub storage: Vec<miden_client::Felt>,
}

impl Default for NoteCreationConfig {
    fn default() -> Self {
        Self {
            note_type: NoteType::Public,
            tag: NoteTag::new(0),
            assets: NoteAssets::default(),
            storage: Vec::new(),
        }
    }
}

/// Creates a note from a compiled note-script package using the client's RNG
/// for a fresh serial number. Suitable for submitting to a live network.
pub fn create_note_from_package(
    client: &mut Client<FilesystemKeyStore>,
    package: Arc<Package>,
    sender_id: miden_client::account::AccountId,
    config: NoteCreationConfig,
) -> Result<Note> {
    let note_script = NoteScript::from_package(package.as_ref())
        .context("Failed to build note script from package")?;
    let serial_num = client.rng().draw_word();

    NoteBuilder::new(
        sender_id,
        &mut RandomCoin::new(Word::from(note_script.root())),
    )
    .package((*package).clone())
    .note_type(config.note_type)
    .tag(config.tag.into())
    .add_assets(config.assets.iter().copied())
    .note_storage(config.storage)
    .context("Failed to attach note storage")?
    .serial_number(serial_num)
    .build()
    .context("Failed to build note from package")
}

/// Creates a deterministic note from a compiled note-script package for testing.
///
/// The note script is resolved from the package's `@note_script`-attributed procedure
/// via `NoteScript::from_package`. The note is built with `NoteBuilder`, which derives the
/// serial number from the note-script digest for deterministic test runs.
pub fn create_testing_note_from_package(
    package: Arc<Package>,
    sender_id: miden_client::account::AccountId,
    config: NoteCreationConfig,
) -> Result<Note> {
    let note_script = NoteScript::from_package(package.as_ref())
        .context("Failed to build note script from package")?;
    let mut rng = RandomCoin::new(Word::from(note_script.root()));

    NoteBuilder::new(sender_id, &mut rng)
        .package((*package).clone())
        .note_type(config.note_type)
        .tag(config.tag.into())
        .add_assets(config.assets.iter().copied())
        .note_storage(config.storage)
        .context("Failed to attach note storage")?
        .build()
        .context("Failed to build note from package")
}

/// Creates a basic wallet account with Falcon512Poseidon2 authentication.
pub async fn create_basic_wallet_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: Arc<FilesystemKeyStore>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let builder = AccountBuilder::new(init_seed)
        .account_type(config.account_type)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet);

    let account = builder
        .build()
        .context("Failed to build basic wallet account")?;

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    keystore
        .add_key(&key_pair, account.id())
        .await
        .context("Failed to add key to keystore")?;

    Ok(account)
}

/// Waits for an on-chain commitment before reporting a successful operation.
pub async fn wait_for_transaction(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: miden_client::transaction::TransactionId,
) -> Result<()> {
    use miden_client::{store::TransactionFilter, transaction::TransactionStatus};
    for _ in 0..36 {
        client.sync_state().await?;
        let records = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        if let Some(record) = records.first() {
            match &record.status {
                TransactionStatus::Committed { block_number, .. } => {
                    println!(
                        "Transaction committed: {} at block {}",
                        tx_id.to_hex(),
                        block_number
                    );
                    return Ok(());
                }
                TransactionStatus::Discarded(cause) => {
                    bail!("Transaction {tx_id} discarded: {cause}")
                }
                TransactionStatus::Pending => {}
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    bail!("Transaction {tx_id} was not committed within 180 seconds")
}

/// Waits for a public native-token P2ID sent to a newly created account, then consumes it.
/// Funding is requested externally while this binary is running.
pub async fn wait_for_native_funding(
    client: &mut Client<FilesystemKeyStore>,
    account_id: miden_client::account::AccountId,
    amount_to_spend: u64,
) -> Result<()> {
    use miden_client::{
        asset::{Asset, FungibleAsset},
        note::P2idNote,
        transaction::TransactionRequestBuilder,
    };

    client.sync_state().await?;
    let header = client.get_latest_block_header().await?;
    let faucet_id = header.fee_parameters().fee_faucet_id();
    if amount_to_spend == 0 && header.fee_parameters().verification_base_fee() == 0 {
        return Ok(());
    }
    let native_id = FungibleAsset::new(faucet_id, 1)?.id();
    println!(
        "Send a public P2ID with native testnet tokens to {}.\n\
         Request the faucet's standard amount to cover {amount_to_spend} base units plus fees.\n\
         Waiting up to 10 minutes for funding...",
        account_id.to_hex()
    );
    for _ in 0..120 {
        client.sync_state().await?;
        let account = client
            .get_account(account_id)
            .await?
            .context("Funding account missing")?;
        if u64::from(account.vault().get_balance(native_id)?) > amount_to_spend {
            return Ok(());
        }
        let notes = client.get_consumable_notes(Some(account_id)).await?;
        let funding = notes.into_iter().find(|(record, _)| {
            record.is_committed()
                && record.details().script().root() == P2idNote::script_root()
                && record.details().assets().iter().any(|asset| {
                    matches!(asset, Asset::Fungible(asset) if asset.faucet_id() == faucet_id)
                })
        });
        if let Some((record, _)) = funding {
            let request =
                TransactionRequestBuilder::new().build_consume_notes(vec![record.try_into()?])?;
            client.sync_state().await?;
            let tx_id = client.submit_new_transaction(account_id, request).await?;
            wait_for_transaction(client, tx_id).await?;
        } else {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    }
    bail!("No sufficient native funding received for {account_id}")
}
