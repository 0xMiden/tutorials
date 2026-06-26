//! Common helper functions for scripts and tests

use std::{path::Path, sync::Arc};

use anyhow::{bail, Context, Result};
use cargo_miden::run;
use miden_client::{
    account::{
        component::{BasicWallet, InitStorageData, NoAuth},
        Account, AccountBuilder, AccountComponent, AccountType,
    },
    auth::{AuthSchemeId, AuthSecretKey, AuthSingleSig},
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
use miden_mast_package::{Package, PackageExport, TargetType};
use miden_standards::testing::note::NoteBuilder;
use rand::RngCore;

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

    let keystore_path = std::path::PathBuf::from("../keystore");
    let keystore =
        Arc::new(FilesystemKeyStore::new(keystore_path).context("Failed to initialize keystore")?);

    let store_path = std::path::PathBuf::from("../store.sqlite3");

    let client = ClientBuilder::new()
        .rpc(rpc_client)
        .sqlite_store(store_path)
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await
        .context("Failed to build Miden client")?;

    Ok(ClientSetup { client, keystore })
}

/// Builds a Miden project in the specified directory via the `cargo-miden` library.
///
/// In addition to returning the compiled [`Package`], the produced `.masp` is persisted
/// to `<dir>/target/miden/<profile>/` (alongside the compiler's `target/midenc/miden/...`
/// output). The FPI `#[account(...)]` macro searches the former path when building any
/// contract that calls this one, so persisting it lets dependent contracts (the notes /
/// transaction script that call the bank account) compile.
pub fn build_project_in_dir(dir: &Path, release: bool) -> Result<Package> {
    let profile = if release { "--release" } else { "--debug" };
    let manifest_path = dir.join("Cargo.toml");
    let manifest_arg = manifest_path.to_string_lossy();

    let args = vec![
        "cargo",
        "miden",
        "build",
        profile,
        "--manifest-path",
        &manifest_arg,
    ];

    let output = run(args.into_iter().map(String::from))
        .context("Failed to compile project")?
        .context("Cargo miden build returned None")?;

    let artifact_path = match output {
        cargo_miden::CommandOutput::BuildCommandOutput { output } => output
            .into_iter()
            .next()
            .context("cargo miden build produced no artifact")?,
        other => bail!("Expected BuildCommandOutput, got {:?}", other),
    };

    let package_bytes = std::fs::read(&artifact_path).context(format!(
        "Failed to read compiled package from {}",
        artifact_path.display()
    ))?;
    let package = Package::read_from_bytes(&package_bytes)
        .context("Failed to deserialize package from bytes")?;

    // Persist the package to the contract's own `target/miden/<profile>` directory, where the
    // FPI `#[account]` macro searches for dependency packages when building a contract that
    // calls this one. The compiler writes the package under the *building crate's*
    // `target/midenc/miden/...` (the build is invoked from the integration crate's cwd via
    // `--manifest-path`), which is not where dependents look.
    let profile_dir = if release { "release" } else { "debug" };
    let dest_dir = dir.join("target").join("miden").join(profile_dir);
    std::fs::create_dir_all(&dest_dir)
        .with_context(|| format!("Failed to create {}", dest_dir.display()))?;
    package.write_masp_file(&dest_dir).map_err(|err| {
        anyhow::anyhow!("Failed to persist package to {}: {err}", dest_dir.display())
    })?;

    Ok(package)
}

/// Builds a [`TransactionScript`] from a compiled transaction-script package.
///
/// A `kind = "tx-script"` contract compiles to a `TransactionScript`-kind package (not an
/// `Executable`), so `TransactionScript::from_package` / `Package::unwrap_program` do not apply.
/// This mirrors the compiler's own helper: locate the `main`/`run` export and build the script
/// from the package's MAST forest plus that entrypoint.
pub fn build_tx_script_from_package(package: &Package) -> Result<TransactionScript> {
    if package.kind != TargetType::TransactionScript {
        bail!(
            "expected a transaction-script package, got {:?}",
            package.kind
        );
    }

    let mut first_procedure = None;
    let mut selected_procedure = None;
    let mut num_procedures = 0usize;
    for export in package.manifest.exports() {
        let PackageExport::Procedure(procedure) = export else {
            continue;
        };
        num_procedures += 1;
        first_procedure.get_or_insert(procedure);
        if matches!(export.name(), "main" | "run") {
            selected_procedure = Some(procedure);
        }
    }

    let procedure = selected_procedure
        .or_else(|| (num_procedures == 1).then(|| first_procedure.unwrap()))
        .context("transaction-script package should export exactly one entry procedure")?;
    let entrypoint = package
        .mast
        .mast_forest()
        .find_procedure_root(procedure.digest)
        .context("transaction-script main export should have a MAST node")?;

    Ok(TransactionScript::from_parts(
        package.mast.mast_forest().clone(),
        entrypoint,
    ))
}

/// Configuration for creating an account with a custom component.
pub struct AccountCreationConfig {
    /// The account type to create. In protocol v0.15 this also encodes the
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

/// Creates an account with a custom component from a compiled package.
pub async fn create_account_from_package(
    client: &mut Client<FilesystemKeyStore>,
    package: Arc<Package>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let account_component = account_component_from_package(package, &config)?;

    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let account = AccountBuilder::new(init_seed)
        .account_type(config.account_type)
        .with_component(account_component)
        .with_auth_component(NoAuth)
        .build()
        .context("Failed to build account")?;

    println!("Account ID: {:?}", account.id());

    client
        .add_account(&account, false)
        .await
        .context("Failed to add account to client")?;

    Ok(account)
}

/// Creates an existing (pre-built) account instance from a compiled package for testing.
pub fn create_testing_account_from_package(
    package: Arc<Package>,
    config: AccountCreationConfig,
) -> Result<Account> {
    let account_component = account_component_from_package(package, &config)?;

    let account = AccountBuilder::new([3u8; 32])
        .account_type(config.account_type)
        .with_component(account_component)
        .with_auth_component(NoAuth)
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

    NoteBuilder::new(sender_id, &mut RandomCoin::new(Word::from(note_script.root())))
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
        .with_auth_component(AuthSingleSig::new(
            key_pair.public_key().to_commitment(),
            AuthSchemeId::Falcon512Poseidon2,
        ))
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
