use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};

use miden_client::{
    account::{component::{InitStorageData, StorageValueName}, StorageSlotName},
    auth::AuthSchemeId,
    transaction::TransactionScript,
    Word,
};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

/// Companion test for Part 6 of the miden-bank tutorial. Verifies that running
/// the init transaction script flips the bank's `initialized` flag from 0 to 1.
///
/// The earlier tutorial parts rely on the bank deferring `require_initialized()`
/// enforcement, so this test exists to prove that once the guard is re-enabled
/// the init flow still works end-to-end before any deposits are accepted.
#[tokio::test]
async fn init_test() -> anyhow::Result<()> {
    // Build the bank-account and init-tx-script contracts
    let bank_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/bank-account"),
        true,
    )?);

    let init_tx_script_package = Arc::new(build_project_in_dir(
        Path::new("../contracts/init-tx-script"),
        true,
    )?);

    // The component's initial storage (initialized = 0, empty balances map) is seeded
    // automatically by `AccountComponent::from_package` using the component's schema;
    // we only need to explicitly seed the `initialized` value slot with a zero Word.
    let initialized_slot = StorageSlotName::new("miden_bank_account::bank::initialized")
        .expect("Valid slot name");

    let bank_cfg = AccountCreationConfig {
        init_storage_data: {
            let mut data = InitStorageData::default();
            data.insert_value(
                StorageValueName::from_slot_name(&initialized_slot),
                Word::default(),
            )?;
            data
        },
        ..Default::default()
    };

    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg)?;

    // Verify bank starts uninitialized
    let before = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(before[0].as_canonical_u64(), 0, "Bank should start uninitialized");
    println!("Before init: initialized = {}", before[0].as_canonical_u64());

    // Build mock chain
    let mut builder = MockChain::builder();
    builder.add_existing_basic_faucet(
        Auth::BasicAuth {
            auth_scheme: AuthSchemeId::Falcon512Poseidon2,
        },
        "TEST",
        10_000_000,
        Some(10),
    )?;
    builder.add_account(bank_account.clone())?;
    let mut mock_chain = builder.build()?;

    // Execute init transaction script
    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new(init_program);

    let init_tx_context = mock_chain
        .build_tx_context(bank_account.id(), &[], &[])?
        .tx_script(init_tx_script)
        .build()?;

    let executed_init = init_tx_context.execute().await?;
    bank_account.apply_delta(&executed_init.account_delta())?;
    mock_chain.add_pending_executed_transaction(&executed_init)?;
    mock_chain.prove_next_block()?;

    // Verify initialized flag flipped to 1
    let after = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(
        after[0].as_canonical_u64(),
        1,
        "Bank should be initialized after running init tx script"
    );
    println!("After init: initialized = {}", after[0].as_canonical_u64());

    println!("\nInit test passed!");
    Ok(())
}
