---
title: "How To Create Notes with Custom Logic"
sidebar_position: 7
---

# How to Create a Custom Note

_Creating notes with custom logic_

For toolchain requirements and shared fee helpers, see the [Rust client setup](./index.md#running-the-v017-examples).

## Overview

In this guide, we will create a custom note on Miden that can only be consumed by someone who knows the preimage of the hash stored in the note. This approach securely embeds assets into the note and restricts spending to those who possess the correct secret number.

By following the steps below and using the Miden Assembly code and Rust example, you will learn how to:

- Create a note with custom logic.
- Store the hash publicly while providing its preimage only to the transaction that consumes the note.

This example uses public accounts and a public note. Its script checks knowledge of the secret, rather than a particular account ID, so any account with the secret and the required wallet procedure can consume it.

## What we'll cover

- Writing Miden assembly for a note
- Consuming notes

## Step-by-step process

### 1. Creating two accounts: Alice & Bob

First, we create two basic accounts for the two users:

- **Alice:** The account that creates and funds the custom note.
- **Bob:** The account that will consume the note if they know the correct secret.

### 2. Hashing the secret number

The security of the custom note hinges on a secret number. Here, we will:

- Choose a secret number (for example, an array of four integers).
- Hash the four field elements directly with `miden_protocol::Hasher::hash_elements`, which uses Poseidon2 in v0.17. The MASM `hash` instruction computes the matching digest; do not prepend an extra zero word to the Rust input.
- Compute the hash of the secret. The resulting hash will be stored in the note’s storage, meaning that the note can only be consumed if the secret number’s hash preimage is provided during consumption.

### 3. Creating the custom note

Now, combine the minted asset and the secret hash to build the custom note. The note is created using the following key steps:

1. **Assets and storage:**
   - The note carries 100 raw units of the tutorial asset and stores the secret's digest in `NoteStorage`. The secret itself is supplied later as the consuming transaction's note arguments.
2. **Miden Assembly Code:**
   - The Miden assembly note script ensures that the note can only be consumed if the provided secret, when hashed, matches the hash stored in the note storage.

Below is the Miden Assembly code for the note. Note scripts are compiled as libraries; the `@note_script` attribute marks the entrypoint procedure.

```masm
use miden::protocol::active_note
use miden::standards::wallets::basic as wallet

# CONSTANTS
# =================================================================================================

const EXPECTED_DIGEST_PTR = 0

# ERRORS
# =================================================================================================

const ERROR_DIGEST_MISMATCH = "Expected digest does not match computed digest"

# PUBLIC INTERFACE
# =================================================================================================

#! Consumes the note's assets when the secret hashes to its stored digest.
#!
#! Inputs:  [HASH_PREIMAGE_SECRET, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - HASH_PREIMAGE_SECRET is the four-felt secret supplied as note arguments.
#!
#! Panics if:
#! - the supplied secret does not match the digest stored in the note.
#!
#! Invocation: dyncall
@note_script
pub proc main(hash_preimage_secret: word)
    # => [HASH_PREIMAGE_SECRET, pad(12)]
    # hashing the secret number
    hash
    # => [DIGEST, pad(12)]

    # writing the note storage to memory.
    # get_storage leaves only [num_storage_items], so drop a single element
    # here, not two, to keep the computed DIGEST intact.
    push.EXPECTED_DIGEST_PTR exec.active_note::get_storage drop

    # pad stack and load expected digest from memory (LE: mem[addr] ends up on top)
    padw push.EXPECTED_DIGEST_PTR mem_loadw_le
    # => [EXPECTED_DIGEST, DIGEST, pad(12)]

    # assert that the note input matches the digest
    # will fail if the two hashes do not match
    assert_eqw.err=ERROR_DIGEST_MISMATCH
    # => [pad(16)]

    # ---------------------------------------------------------------------------------------------
    # if the check is successful, we allow for the asset to be consumed
    # ---------------------------------------------------------------------------------------------

    # add all assets from the note to the account
    exec.wallet::move_note_assets_to_account
    # => [pad(16)]
end
```

### How the assembly code works:

1. **Constants and Error Handling:**  
   The code defines a memory pointer (`EXPECTED_DIGEST_PTR`) for storing the expected hash and an error message for digest mismatches.
2. **Passing the Secret:**  
   The secret number is passed as `Note Arguments` into the note.
3. **Hashing the Secret:**  
   The `hash` instruction applies a Poseidon2 hash permutation to the secret number, resulting in a digest that takes up four stack elements.
4. **Digest Comparison:**  
   The assembly code loads the expected digest from note storage into memory, then reads it back with `mem_loadw_le` (which places `mem[addr]` on top, matching the hash output order) and compares with the computed hash. If they don't match, the transaction fails with a clear error message.
5. **Asset Transfer:**  
   If the hash matches, `wallet::move_note_assets_to_account` explicitly removes all assets from the note and transfers them into the consuming account's vault.

### 4. Consuming the note

With the note created, Bob can now consume it—but only if he provides the correct secret. When Bob initiates the transaction to consume the note, he must supply the same secret number used when Alice created the note. The custom note’s logic will hash the secret and compare it with its stored hash. If they match, Bob’s wallet receives the asset.

---

## Set up the Rust project

Start in the directory containing your `tutorials` clone and create a sibling Cargo project:

```bash
cargo new miden-custom-note
cd miden-custom-note
rustup override set 1.98.1
cp ../tutorials/rust-client/Cargo.lock Cargo.lock
```

Keep the generated `[package]` section in `Cargo.toml`, replace its empty `[dependencies]` section with the following, and add the development profile. The path assumes the repository clone is named `tutorials`.

```toml
[dependencies]
# Clone tutorials next to this Cargo project (see Rust client setup).
rust-client = { path = "../tutorials/rust-client" }
miden-client = { version = "=0.17.2", features = ["testing", "tonic"] }
miden-client-sqlite-store = { version = "=0.17.2", package = "miden-client-sqlite-store" }
miden-protocol = { version = "=0.17.1" }
rand = { version = "0.10" }
tokio = { version = "1.48", features = ["rt-multi-thread", "net", "macros", "fs"] }

[profile.dev]
opt-level = 2
```

Copy the complete Rust example below into `src/main.rs`. Run it from this new project's directory with `TUTORIAL_NETWORK=testnet cargo run --release`. The client creates `store.sqlite3` and `keystore/` here; keep both out of version control.

## Full Rust code example

The following Rust code demonstrates how to implement the steps outlined above using the Miden client library:

```rust no_run
use rand::Rng;
use rust_client::TutorialClientExt;
use std::{path::PathBuf, sync::Arc};

use miden_client::{
    Client, ClientError, Felt,
    account::{
        Account, AccountBuilder, AccountType,
        component::{
            create_singlesig_user_fungible_faucet, BasicWallet, BurnPolicy, FungibleFaucet,
            MintPolicy, TokenName, TokenPolicyManager,
        },
    },
    asset::{AssetAmount, AssetId, FungibleAsset, TokenSymbol},
    auth::{AuthSecretKey, AuthSingleSig},
    builder::ClientBuilder,
    rng::draw_word,
    keystore::{FilesystemKeyStore, Keystore},
    note::{Note, NoteAssets, NoteRecipient, NoteStorage, NoteTag, NoteType, PartialNoteMetadata},
    rpc::{GrpcClient, VerifyingRpcClient},
    transaction::{TransactionId, TransactionRequestBuilder},
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::Hasher;
use rust_client::{FeeConfig, TutorialNetwork, fund_account_for_fees};

// Helper to create a basic account
async fn create_basic_account(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &Arc<FilesystemKeyStore>,
) -> Result<Account, ClientError> {
    let mut init_seed = [0_u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());

    let account = AccountBuilder::new(init_seed)
        .account_type(AccountType::Public)
        .with_component(AuthSingleSig::from_public_key(key_pair.public_key()))
        .with_component(BasicWallet)
        .build()
        .unwrap();

    client.add_account(&account, false).await?;
    keystore.add_key(&key_pair, account.id()).await.unwrap();

    Ok(account)
}

async fn create_basic_faucet(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &Arc<FilesystemKeyStore>,
) -> Result<Account, ClientError> {
    let mut init_seed = [0u8; 32];
    client.rng().fill_bytes(&mut init_seed);

    let key_pair = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let symbol = TokenSymbol::new("MID").unwrap();
    let decimals = 8;
    let max_supply = AssetAmount::new(1_000_000).unwrap();

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
    let account = create_singlesig_user_fungible_faucet(
        init_seed,
        faucet,
        AuthSingleSig::from_public_key(key_pair.public_key()),
        policies,
        AccountType::Public,
    )
    .unwrap();

    client.add_account(&account, false).await?;
    keystore.add_key(&key_pair, account.id()).await.unwrap();

    Ok(account)
}

/// Waits for a specific transaction to be committed.
async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    rust_client::wait_for_transaction(client, tx_id).await
}

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
    // STEP 1: Create accounts and deploy faucet
    // -------------------------------------------------------------------------
    println!("\n[STEP 1] Creating new accounts");
    let alice_account = create_basic_account(&mut client, &keystore).await?;
    println!(
        "Alice's account ID: {:?}",
        alice_account.id().to_bech32(network.network_id())
    );
    let bob_account = create_basic_account(&mut client, &keystore).await?;
    println!(
        "Bob's account ID: {:?}",
        bob_account.id().to_bech32(network.network_id())
    );

    println!("\nDeploying a new fungible faucet.");
    let faucet = create_basic_faucet(&mut client, &keystore).await?;
    println!(
        "Faucet account ID: {:?}",
        faucet.id().to_bech32(network.network_id())
    );
    for account_id in [alice_account.id(), bob_account.id(), faucet.id()] {
        fund_account_for_fees(&mut client, account_id, &fee_config).await?;
    }
    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 2: Mint tokens with P2ID
    // -------------------------------------------------------------------------
    println!("\n[STEP 2] Mint tokens with P2ID");
    let faucet_id = faucet.id();
    let amount: u64 = 100;
    let mint_amount = FungibleAsset::new(faucet_id, amount).unwrap();
    let tx_request = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(
            mint_amount,
            alice_account.id(),
            NoteType::Public,
            client.rng(),
        )
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(faucet.id(), tx_request)
        .await?;
    println!("Minted tokens. TX: {:?}", tx_id);

    // Wait for the note to be available
    client.sync_state().await?;
    wait_for_tx(&mut client, tx_id).await?;

    // Consume the minted note
    let consumable_notes = client
        .get_consumable_tutorial_notes(Some(alice_account.id()))
        .await?;

    if let Some((note_record, _)) = consumable_notes.first() {
        let note: Note = note_record.clone().try_into()?;
        let consume_request = TransactionRequestBuilder::new().build_consume_notes(vec![note])?;

        let tx_id = client
            .submit_tutorial_transaction(alice_account.id(), consume_request)
            .await?;
        println!("Consumed minted note. TX: {:?}", tx_id);
    }

    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 3: Create custom note
    // -------------------------------------------------------------------------
    println!("\n[STEP 3] Create custom note");
    let secret_vals = vec![
        Felt::new_unchecked(1),
        Felt::new_unchecked(2),
        Felt::new_unchecked(3),
        Felt::new_unchecked(4),
    ];
    let digest = Hasher::hash_elements(&secret_vals);
    println!("digest: {:?}", digest);

    // Read the MASM source from the tutorials repository.
    let code = std::fs::read_to_string("../tutorials/masm/notes/hash_preimage_note.masm").unwrap();
    let serial_num = draw_word(client.rng());

    let note_script = client.code_builder().compile_note_script(&code).unwrap();
    let note_storage = NoteStorage::new(digest.to_vec()).unwrap();
    let recipient = NoteRecipient::new(serial_num, note_script, note_storage);
    let tag = NoteTag::new(0);
    let metadata = PartialNoteMetadata::new(alice_account.id(), NoteType::Public).with_tag(tag);
    let vault = NoteAssets::new(vec![mint_amount.into()])?;
    let custom_note = Note::new(vault, metadata, recipient);
    println!("note hash: {:?}", custom_note.id().to_hex());

    let note_request = TransactionRequestBuilder::new()
        .own_output_notes(vec![custom_note.clone()])
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(alice_account.id(), note_request)
        .await?;
    println!(
        "View transaction on MidenScan: {}/tx/{:?}",
        network.explorer_url(),
        tx_id
    );

    client.sync_state().await?;

    // -------------------------------------------------------------------------
    // STEP 4: Consume the Custom Note
    // -------------------------------------------------------------------------
    println!("\n[STEP 4] Bob consumes the Custom Note with Correct Secret");

    let secret = [
        Felt::new_unchecked(1),
        Felt::new_unchecked(2),
        Felt::new_unchecked(3),
        Felt::new_unchecked(4),
    ];
    let consume_custom_request = TransactionRequestBuilder::new()
        .input_notes([(custom_note, Some(secret.into()))])
        .build()
        .unwrap();

    let tx_id = client
        .submit_tutorial_transaction(bob_account.id(), consume_custom_request)
        .await?;
    println!(
        "Consumed Note Tx on MidenScan: {}/tx/{:?} \n",
        network.explorer_url(),
        tx_id
    );

    wait_for_tx(&mut client, tx_id).await?;

    let bob = client
        .get_account(bob_account.id())
        .await?
        .expect("Bob's account must exist after consuming the note");
    let balance = bob.vault().get_balance(AssetId::new_fungible(faucet_id))?;
    assert_eq!(
        balance.as_u64(),
        amount,
        "Bob must receive all assets from the hash-preimage note",
    );
    println!("Bob's custom-note token balance: {balance}");

    Ok(())
}
```

The following is an abbreviated output; IDs vary, and funding and repeated confirmation messages are omitted:

```text
Latest block: <current_block_number>

[STEP 1] Creating new accounts
Alice's account ID: "<testnet_account_id>"
Bob's account ID: "<testnet_account_id>"

Deploying a new fungible faucet.
Faucet account ID: "<testnet_account_id>"

[STEP 2] Mint tokens with P2ID
Minted tokens. TX: <transaction_id>
Transaction committed: <transaction_id>
Consumed minted note. TX: <transaction_id>

[STEP 3] Create custom note
digest: Word([14206540680072267069, 9571949196318390099, 5950603493574130513, 3457190364553631046])
note hash: "0xf48f362f1817bbc5575e0bb8b77c496dd67e4b85d8ff45d21dff5743de2b174d"
View transaction on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>

[STEP 4] Bob consumes the Custom Note with Correct Secret
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<transaction_id>

Transaction committed: <transaction_id>
Bob's custom-note token balance: 100
```

## Conclusion

You have now seen how to create a custom note on Miden that requires a secret preimage to be consumed. We covered:

1. Creating and funding accounts (Alice and Bob)
2. Hashing a secret number
3. Building a note with custom logic in Miden Assembly
4. Consuming the note by providing the correct secret

The fixed secret `[1, 2, 3, 4]` is for demonstration. A real secret must be unpredictable and shared only with the intended consumer. Anyone who learns it can satisfy this note's spending condition.

### Running the example

From the root of your `tutorials` clone, run the checked-in example:

```bash
cd rust-client
TUTORIAL_NETWORK=testnet cargo run --release --bin hash_preimage_note
```

### Continue learning

Next tutorial: [How to Use Unauthenticated Notes](unauthenticated_note_how_to.md)
