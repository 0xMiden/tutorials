use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};
use tokio::time::{Duration, Instant};

use miden_client::{
    account::{
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
        AccountBuilder, AccountType,
    },
    asset::{AssetAmount, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteType, P2idNote},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::TransactionRequestBuilder,
    utils::{Deserializable, Serializable},
    Client, ClientError,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::transaction::InputNote;
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

    //------------------------------------------------------------
    // STEP 1: Deploy a fungible faucet
    //------------------------------------------------------------
    println!("\n[STEP 1] Deploying a new fungible faucet.");

    // Faucet seed
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    // Generate key pair
    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    // Faucet parameters
    let symbol = TokenSymbol::new("MID").unwrap();
    let decimals = 8;
    let max_supply = AssetAmount::new(1_000_000).unwrap();

    // Build the account
    let faucet = FungibleFaucet::builder()
        .name(TokenName::new("MID").unwrap())
        .symbol(symbol)
        .decimals(decimals)
        .max_supply(max_supply)
        .build()
        .unwrap();
    let policies = TokenPolicyManager::builder()
        .active_mint_policy(MintPolicy::allow_all())
        .active_burn_policy(BurnPolicy::allow_all())
        .build();
    let faucet_account = create_singlesig_user_fungible_faucet(
        init_seed,
        faucet,
        AuthSingleSig::from_public_key(key_pair.public_key()),
        policies,
        AccountType::Public,
    )
    .unwrap();

    // Add the faucet to the client
    client.add_account(&faucet_account, false).await?;

    println!(
        "Faucet account ID: {}",
        faucet_account.id().to_bech32(network.network_id())
    );

    // Add the key pair to the keystore
    keystore
        .add_key(&key_pair, faucet_account.id())
        .await
        .unwrap();
    fund_account_for_fees(&mut client, faucet_account.id(), &fee_config).await?;

    // Resync to show newly deployed faucet
    tokio::time::sleep(Duration::from_secs(2)).await;
    client.sync_state().await?;

    //------------------------------------------------------------
    // STEP 2: Create basic wallet accounts
    //------------------------------------------------------------
    println!("\n[STEP 2] Creating new accounts");

    let mut accounts = vec![];
    let number_of_accounts = 5;

    for i in 0..number_of_accounts {
        let mut init_seed = [0_u8; 32];
        client.rng().fill_bytes(&mut init_seed);

        let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

        let account = AccountBuilder::new(init_seed)
            .account_type(AccountType::Public)
            .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
            .with_component(BasicWallet)
            .build()
            .unwrap();

        accounts.push(account.clone());
        println!(
            "account id {:?}: {}",
            i,
            account.id().to_bech32(network.network_id())
        );
        client.add_account(&account, true).await?;

        // Add the key pair to the keystore
        keystore.add_key(&key_pair, account.id()).await.unwrap();
        fund_account_for_fees(&mut client, account.id(), &fee_config).await?;
    }

    // For demo purposes, Alice is the first account.
    let alice = &accounts[0];

    //------------------------------------------------------------
    // STEP 3: Mint and consume tokens for Alice
    //------------------------------------------------------------
    println!("\n[STEP 3] Mint tokens");
    println!("Minting tokens for Alice...");
    let amount: u64 = 100;
    let fungible_asset_mint_amount = FungibleAsset::new(faucet_account.id(), amount).unwrap();
    let transaction_request = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(
            fungible_asset_mint_amount,
            alice.id(),
            NoteType::Public,
            client.rng(),
        )
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(faucet_account.id(), transaction_request)
        .await?;
    println!("Minted tokens. TX: {:?}", tx_id);

    // Wait for mint transaction to be committed

    // Get the minted note and consume it
    let consumable_notes = client
        .get_consumable_tutorial_notes(Some(alice.id()))
        .await?;

    if let Some((note_record, _)) = consumable_notes.first() {
        let note: Note = note_record.clone().try_into()?;
        let transaction_request =
            TransactionRequestBuilder::new().build_consume_notes(vec![note])?;

        let consume_tx_id = client
            .submit_tutorial_transaction(alice.id(), transaction_request)
            .await?;
        println!("Consumed minted note. TX: {:?}", consume_tx_id);

        // Wait for consumption to complete
    }

    //------------------------------------------------------------
    // STEP 4: Create unauthenticated note tx chain
    //------------------------------------------------------------
    println!("\n[STEP 4] Create unauthenticated note tx chain");
    let start = Instant::now();

    for i in 0..number_of_accounts - 1 {
        let loop_start = Instant::now();
        println!("\nunauthenticated tx {:?}", i + 1);
        println!(
            "sender: {}",
            accounts[i].id().to_bech32(network.network_id())
        );
        println!(
            "target: {}",
            accounts[i + 1].id().to_bech32(network.network_id())
        );

        // Time the creation of the p2id note
        let send_amount = 20;
        let fungible_asset_send_amount =
            FungibleAsset::new(faucet_account.id(), send_amount).unwrap();

        // for demo purposes, unauthenticated notes can be public or private
        let note_type = if i % 2 == 0 {
            NoteType::Private
        } else {
            NoteType::Public
        };

        let p2id_note: Note = P2idNote::builder()
            .sender(accounts[i].id())
            .target(accounts[i + 1].id())
            .asset(fungible_asset_send_amount)
            .note_type(note_type)
            .generate_serial_number(client.rng())
            .build()
            .unwrap()
            .into();

        let output_note = p2id_note.clone();

        // Time transaction request building
        let transaction_request = TransactionRequestBuilder::new()
            .own_output_notes(vec![output_note])
            .build()
            .unwrap();

        // Do not wait for inclusion: the receiver is given the complete note below.
        client.sync_state().await?;
        let send_tx_id = client
            .submit_new_transaction(accounts[i].id(), transaction_request)
            .await?;
        println!("Created note. TX: {:?}", send_tx_id);

        // Note serialization/deserialization
        // This demonstrates how you could send the serialized note to another client instance
        let serialized = p2id_note.to_bytes();
        let deserialized_p2id_note = Note::read_from_bytes(&serialized).unwrap();

        // Time consume note request building
        // Keep this input unauthenticated even if syncing has already fetched its proof.
        let consume_note_request = TransactionRequestBuilder::new()
            .explicit_input_notes([(InputNote::unauthenticated(deserialized_p2id_note), None)])
            .build()?;

        let tx_id = client
            .submit_tutorial_transaction(accounts[i + 1].id(), consume_note_request)
            .await?;
        rust_client::wait_for_transaction(&mut client, send_tx_id).await?;

        println!(
            "Consumed Note Tx on MidenScan: {}/tx/{:?}",
            network.explorer_url(),
            tx_id
        );
        println!(
            "Total time for loop iteration {}: {:?}",
            i,
            loop_start.elapsed()
        );
    }

    println!(
        "\nTotal execution time for unauthenticated note txs: {:?}",
        start.elapsed()
    );

    // Final resync and display account balances
    tokio::time::sleep(Duration::from_secs(3)).await;
    client.sync_state().await?;
    for (index, account) in accounts.iter().enumerate() {
        let new_account = client.get_account(account.id()).await.unwrap().unwrap();
        let balance = new_account
            .vault()
            .get_balance(AssetId::new_fungible(faucet_account.id()))
            .unwrap();
        println!(
            "Account: {} balance: {}",
            account.id().to_bech32(network.network_id()),
            balance
        );
        let expected = if index == 0 {
            80
        } else if index == accounts.len() - 1 {
            20
        } else {
            0
        };
        assert_eq!(
            balance.as_u64(),
            expected,
            "unexpected transfer-chain balance"
        );
    }

    Ok(())
}
