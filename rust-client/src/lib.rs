//! Shared network and transaction-fee setup used by the executable tutorials.

use std::{env, fmt::Display, time::Duration};

use miden_client::{
    account::{AccountId, Address},
    address::NetworkId,
    note::{Note, NoteConsumability, NoteId, TxFeeNote},
    rpc::Endpoint,
    store::{InputNoteRecord, TransactionFilter},
    transaction::{
        TransactionAuthenticator, TransactionId, TransactionRequest, TransactionRequestBuilder,
        TransactionStatus,
    },
    Client, ClientError,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

// Allow for asynchronous network-note execution, but never poll indefinitely.
const DEFAULT_SYNC_RETRIES: u32 = 24;
const SYNC_RETRY_DELAY: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Fee-aware execution safeguards shared by the runnable examples.
#[allow(async_fn_in_trait)]
pub trait TutorialClientExt {
    /// Refreshes the reference block, submits the transaction and verifies commitment.
    async fn submit_tutorial_transaction(
        &mut self,
        account_id: AccountId,
        request: TransactionRequest,
    ) -> Result<TransactionId, ClientError>;
    /// Excludes TX_FEE notes, which are consumable but are not tutorial transfers.
    async fn get_consumable_tutorial_notes(
        &self,
        account_id: Option<AccountId>,
    ) -> Result<Vec<(InputNoteRecord, Vec<NoteConsumability>)>, ClientError>;
}

impl<AUTH: TransactionAuthenticator + Sync + 'static> TutorialClientExt for Client<AUTH> {
    async fn submit_tutorial_transaction(
        &mut self,
        account_id: AccountId,
        request: TransactionRequest,
    ) -> Result<TransactionId, ClientError> {
        self.sync_state().await?;
        let tx_id = self.submit_new_transaction(account_id, request).await?;
        wait_for_transaction(self, tx_id).await?;
        Ok(tx_id)
    }

    async fn get_consumable_tutorial_notes(
        &self,
        account_id: Option<AccountId>,
    ) -> Result<Vec<(InputNoteRecord, Vec<NoteConsumability>)>, ClientError> {
        let mut notes = self.get_consumable_notes(account_id).await?;
        notes.retain(|(note, _)| is_tutorial_note_script(note.details().script().root()));
        Ok(notes)
    }
}

fn is_tutorial_note_script(root: miden_client::note::NoteScriptRoot) -> bool {
    root != TxFeeNote::script_root()
}

/// Waits for actual on-chain commitment, failing with the transaction ID on timeout.
pub async fn wait_for_transaction<AUTH: TransactionAuthenticator + Sync + 'static>(
    client: &mut Client<AUTH>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    let retries = env_u32("MIDEN_TX_SYNC_RETRIES", DEFAULT_SYNC_RETRIES)?;
    for attempt in 0..retries {
        client.sync_state().await?;
        let records = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        if let Some(record) = records.first() {
            if matches!(record.status, TransactionStatus::Committed { .. }) {
                println!("Transaction committed: {tx_id}");
                return Ok(());
            }
            if let TransactionStatus::Discarded(cause) = &record.status {
                return Err(tutorial_error(format!(
                    "transaction {tx_id} was discarded: {cause}"
                )));
            }
        }
        if attempt + 1 < retries {
            tokio::time::sleep(SYNC_RETRY_DELAY).await;
        }
    }
    Err(tutorial_error(format!(
        "transaction {tx_id} was not committed after {retries} sync attempts"
    )))
}

/// Fetches exactly the notes created by the example, not unrelated or TX_FEE notes.
pub async fn wait_for_notes_by_id<AUTH: TransactionAuthenticator + Sync + 'static>(
    client: &mut Client<AUTH>,
    ids: &[NoteId],
) -> Result<Vec<Note>, ClientError> {
    for attempt in 0..DEFAULT_SYNC_RETRIES {
        client.sync_state().await?;
        let mut notes = Vec::new();
        for id in ids {
            if let Some(record) = client.get_input_note(*id).await? {
                if record.is_committed() {
                    notes.push(record.try_into()?);
                }
            }
        }
        if notes.len() == ids.len() {
            return Ok(notes);
        }
        if attempt + 1 < DEFAULT_SYNC_RETRIES {
            tokio::time::sleep(SYNC_RETRY_DELAY).await;
        }
    }
    Err(tutorial_error(format!(
        "expected notes were not committed within the timeout: {ids:?}"
    )))
}

/// Network selected for a tutorial run.
///
/// `TUTORIAL_NETWORK` takes precedence over `MIDEN_NETWORK`; both accept `testnet` or `devnet`.
/// When neither is set, tutorials use testnet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TutorialNetwork {
    Testnet,
    Devnet,
}

impl TutorialNetwork {
    pub fn from_env() -> Result<Self, ClientError> {
        let value = env::var("TUTORIAL_NETWORK")
            .or_else(|_| env::var("MIDEN_NETWORK"))
            .unwrap_or_else(|_| "testnet".to_owned());

        match value.to_ascii_lowercase().as_str() {
            "testnet" => Ok(Self::Testnet),
            "devnet" => Ok(Self::Devnet),
            other => Err(tutorial_error(format!(
                "unsupported tutorial network `{other}`; use `testnet` or `devnet`"
            ))),
        }
    }

    pub fn endpoint(self) -> Endpoint {
        match self {
            Self::Testnet => Endpoint::testnet(),
            Self::Devnet => Endpoint::devnet(),
        }
    }

    pub fn network_id(self) -> NetworkId {
        match self {
            Self::Testnet => NetworkId::Testnet,
            Self::Devnet => NetworkId::Devnet,
        }
    }

    pub fn explorer_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://testnet.midenscan.com",
            Self::Devnet => "https://devnet.midenscan.com",
        }
    }

    pub fn remote_prover_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://tx-prover.testnet.miden.io",
            Self::Devnet => "https://tx-prover.devnet.miden.io",
        }
    }

    fn faucet_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://faucet-api.testnet.miden.io",
            Self::Devnet => "https://faucet-api.devnet.miden.io",
        }
    }
}

/// Fee parameters read from the client's current reference block.
#[derive(Debug, Clone, Copy)]
pub struct FeeConfig {
    network: TutorialNetwork,
    fee_faucet_id: AccountId,
    verification_base_fee: u32,
}

impl FeeConfig {
    pub async fn from_client<AUTH>(
        client: &Client<AUTH>,
        network: TutorialNetwork,
    ) -> Result<Self, ClientError> {
        let header = client.get_latest_block_header().await?;
        let parameters = header.fee_parameters();

        Ok(Self {
            network,
            fee_faucet_id: client
                .get_protocol_config(header.protocol_config_commitment())
                .await?
                .fee_asset_id()
                .faucet_id(),
            verification_base_fee: parameters.verification_base_fee(),
        })
    }

    pub fn fees_are_active(&self) -> bool {
        self.verification_base_fee != 0
    }

    pub fn native_fee_faucet_id(&self) -> AccountId {
        self.fee_faucet_id
    }
}

/// Funds a newly-created account with the native fee asset when the selected network charges fees.
///
/// The faucet creates a public P2ID note. This function waits until the note is committed, then
/// consumes it as the account's first transaction. Accounts using this helper must expose
/// `BasicWallet`, since P2ID moves its assets through `BasicWallet::receive_asset`.
///
/// Environment overrides:
/// - `MIDEN_FAUCET_URL`: faucet REST API base URL.
/// - `MIDEN_FAUCET_API_KEY`: optional faucet API key.
/// - `MIDEN_FEE_AMOUNT`: native base units requested per account (defaults to the faucet's
///   advertised base amount).
/// - `MIDEN_FEE_SYNC_RETRIES`: number of five-second sync attempts (default 24).
pub async fn fund_account_for_fees<AUTH>(
    client: &mut Client<AUTH>,
    account_id: AccountId,
    fee_config: &FeeConfig,
) -> Result<(), ClientError>
where
    AUTH: TransactionAuthenticator + Sync + 'static,
{
    if !fee_config.fees_are_active() {
        return Ok(());
    }

    let requested_amount = env::var("MIDEN_FEE_AMOUNT")
        .ok()
        .map(|value| {
            value.parse::<u64>().map_err(|error| {
                tutorial_error(format!("invalid MIDEN_FEE_AMOUNT value `{value}`: {error}"))
            })
        })
        .transpose()?;

    let api_url =
        env::var("MIDEN_FAUCET_URL").unwrap_or_else(|_| fee_config.network.faucet_url().to_owned());
    let api_key = env::var("MIDEN_FAUCET_API_KEY").ok();

    println!(
        "Requesting native fee funding for {} from {api_url}",
        account_id.to_hex()
    );

    let (note_id, amount) = request_fee_note(
        &api_url,
        api_key.as_deref(),
        account_id,
        requested_amount,
        fee_config.network.network_id(),
    )
    .await?;
    println!(
        "Funding request accepted; waiting for public note {} with {amount} native fee units",
        note_id.to_hex()
    );
    let retries = env_u32("MIDEN_FEE_SYNC_RETRIES", DEFAULT_SYNC_RETRIES)?;
    let note_id_hex = note_id.to_hex();

    let mut note_record = None;
    for attempt in 1..=retries {
        client.sync_state().await?;
        if let Some(record) = client.get_input_note(note_id).await? {
            if record.is_committed() {
                note_record = Some(record);
                break;
            }
        }

        if attempt < retries {
            tokio::time::sleep(SYNC_RETRY_DELAY).await;
        }
    }

    let note_record = note_record.ok_or_else(|| {
        tutorial_error(format!(
            "native fee note {note_id_hex} was not committed after {retries} sync attempts"
        ))
    })?;
    // The faucet metadata identifies the funding wallet in v0.17, not the asset issuer.
    // Validate the committed note against the chain's native fee asset instead.
    let native_asset_id = miden_client::asset::AssetId::new_fungible(fee_config.fee_faucet_id);
    if !note_record
        .details()
        .assets()
        .iter()
        .any(|asset| asset.id() == native_asset_id)
    {
        return Err(tutorial_error(format!(
            "funding note {note_id_hex} does not contain the native fee asset {native_asset_id}"
        )));
    }
    let input_note = note_record.try_into()?;

    let request = TransactionRequestBuilder::new().build_consume_notes(vec![input_note])?;
    client.sync_state().await?;
    let transaction_id = client.submit_new_transaction(account_id, request).await?;
    println!("Native fee funding transaction submitted: {transaction_id:?}");

    for attempt in 1..=retries {
        client.sync_state().await?;
        let transactions = client
            .get_transactions(TransactionFilter::Ids(vec![transaction_id]))
            .await?;
        if let Some(transaction) = transactions.first() {
            match &transaction.status {
                TransactionStatus::Committed { .. } => {
                    println!("Native fee funding transaction committed: {transaction_id:?}");
                    return Ok(());
                }
                TransactionStatus::Discarded(cause) => {
                    return Err(tutorial_error(format!(
                        "native fee funding transaction {transaction_id:?} was discarded: {cause}"
                    )));
                }
                TransactionStatus::Pending => {}
            }
        }

        if attempt < retries {
            tokio::time::sleep(SYNC_RETRY_DELAY).await;
        }
    }

    return Err(tutorial_error(format!(
        "native fee funding transaction {transaction_id:?} was not committed after {retries} sync attempts"
    )));
}

#[derive(Debug, Deserialize)]
struct PowResponse {
    challenge: String,
    target: u64,
}

#[derive(Debug, Deserialize)]
struct MintResponse {
    note_id: String,
}

#[derive(Debug, Deserialize)]
struct MetadataResponse {
    id: String,
    base_amount: u64,
}

async fn request_fee_note(
    api_url: &str,
    api_key: Option<&str>,
    account_id: AccountId,
    requested_amount: Option<u64>,
    expected_network_id: NetworkId,
) -> Result<(NoteId, u64), ClientError> {
    let http = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| tutorial_error(format!("failed to build faucet HTTP client: {error}")))?;
    let base_url = reqwest::Url::parse(api_url)
        .map_err(|error| tutorial_error(format!("invalid MIDEN_FAUCET_URL: {error}")))?;

    let metadata_url = base_url
        .join("get_metadata")
        .map_err(|error| tutorial_error(format!("invalid faucet metadata URL: {error}")))?;
    let response = http
        .get(metadata_url)
        .send()
        .await
        .map_err(|error| tutorial_error(format!("faucet metadata request failed: {error}")))?;
    let response = checked_response(response, "metadata", api_url).await?;
    let metadata: MetadataResponse = response.json().await.map_err(|error| {
        tutorial_error(format!(
            "failed to decode faucet metadata response: {error}"
        ))
    })?;
    let (actual_network_id, _) = Address::decode(&metadata.id).map_err(|error| {
        tutorial_error(format!(
            "faucet metadata returned an invalid address `{}`: {error}",
            metadata.id
        ))
    })?;
    if actual_network_id != expected_network_id {
        return Err(tutorial_error(format!(
            "faucet {api_url} is for {actual_network_id:?}, but the tutorial is using {expected_network_id:?}"
        )));
    }
    let amount = requested_amount.unwrap_or(metadata.base_amount);
    if amount == 0 {
        return Err(tutorial_error(
            "MIDEN_FEE_AMOUNT or the faucet's advertised base amount must be greater than zero",
        ));
    }

    let mut pow_params = vec![
        ("account_id", account_id.to_hex()),
        ("amount", amount.to_string()),
    ];
    if let Some(api_key) = api_key {
        pow_params.push(("api_key", api_key.to_owned()));
    }

    let pow_url = base_url
        .join("pow")
        .map_err(|error| tutorial_error(format!("invalid faucet PoW URL: {error}")))?;
    let response = http
        .get(pow_url)
        .query(&pow_params)
        .send()
        .await
        .map_err(|error| tutorial_error(format!("faucet PoW request failed: {error}")))?;
    let response = checked_response(response, "PoW", api_url).await?;
    let pow: PowResponse = response.json().await.map_err(|error| {
        tutorial_error(format!("failed to decode faucet PoW response: {error}"))
    })?;
    let nonce = solve_pow(pow.challenge.clone(), pow.target).await?;

    let mut mint_params = vec![
        ("account_id", account_id.to_hex()),
        ("is_private_note", "false".to_owned()),
        ("asset_amount", amount.to_string()),
        ("challenge", pow.challenge),
        ("nonce", nonce.to_string()),
    ];
    if let Some(api_key) = api_key {
        mint_params.push(("api_key", api_key.to_owned()));
    }

    let mint_url = base_url
        .join("get_tokens")
        .map_err(|error| tutorial_error(format!("invalid faucet mint URL: {error}")))?;
    let response = http
        .get(mint_url)
        .query(&mint_params)
        .send()
        .await
        .map_err(|error| tutorial_error(format!("faucet mint request failed: {error}")))?;
    let response = checked_response(response, "mint", api_url).await?;
    let mint: MintResponse = response.json().await.map_err(|error| {
        tutorial_error(format!("failed to decode faucet mint response: {error}"))
    })?;

    let note_id = NoteId::try_from_hex(&mint.note_id)
        .map_err(|error| tutorial_error(format!("faucet returned an invalid note ID: {error}")))?;
    Ok((note_id, amount))
}

async fn checked_response(
    response: reqwest::Response,
    operation: &str,
    api_url: &str,
) -> Result<reqwest::Response, ClientError> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(tutorial_error(format!(
        "faucet {operation} request to {api_url} failed with {status}: {body}. Set \
         MIDEN_FAUCET_URL to a fee-faucet API compatible with the selected network"
    )))
}

async fn solve_pow(challenge_hex: String, target: u64) -> Result<u64, ClientError> {
    if target == 0 {
        return Err(tutorial_error("faucet returned a zero PoW target"));
    }
    let challenge = hex::decode(&challenge_hex).map_err(|error| {
        tutorial_error(format!("faucet returned invalid challenge hex: {error}"))
    })?;

    tokio::task::spawn_blocking(move || {
        for nonce in 0..=u64::MAX {
            let mut hasher = Sha256::new();
            hasher.update(&challenge);
            hasher.update(nonce.to_be_bytes());
            let digest = hasher.finalize();
            let prefix = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 prefix"));
            if prefix < target {
                return nonce;
            }
        }
        unreachable!("a valid u64 PoW nonce should exist")
    })
    .await
    .map_err(|error| tutorial_error(format!("faucet PoW task failed: {error}")))
}

fn env_u32(name: &str, default: u32) -> Result<u32, ClientError> {
    env::var(name).map_or(Ok(default), |value| {
        value
            .parse()
            .map_err(|error| tutorial_error(format!("invalid {name} value `{value}`: {error}")))
    })
}

fn tutorial_error(message: impl Display) -> ClientError {
    ClientError::Observer(Box::new(std::io::Error::other(message.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_client::note::P2idNote;

    #[test]
    fn fee_notes_do_not_count_as_tutorial_transfers() {
        assert!(!is_tutorial_note_script(TxFeeNote::script_root()));
        assert!(is_tutorial_note_script(P2idNote::script_root()));
    }

    #[tokio::test]
    async fn invalid_pow_challenges_fail_instead_of_looping() {
        assert!(solve_pow("00".into(), 0).await.is_err());
        assert!(solve_pow("not hex".into(), u64::MAX).await.is_err());
    }

    #[tokio::test]
    async fn pow_nonce_satisfies_faucet_target() {
        let nonce = solve_pow("abcd".into(), u64::MAX).await.unwrap();
        let mut hasher = Sha256::new();
        hasher.update([0xab, 0xcd]);
        hasher.update(nonce.to_be_bytes());
        let digest = hasher.finalize();
        assert!(u64::from_be_bytes(digest[..8].try_into().unwrap()) < u64::MAX);
    }
}
