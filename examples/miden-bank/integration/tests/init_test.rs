use integration::helpers::{
    build_project_in_dir, create_testing_account_from_package, AccountCreationConfig,
};

use miden_client::{
    account::{StorageMap, StorageSlot, StorageSlotName},
    transaction::TransactionScript,
    Word,
};
use miden_testing::{Auth, MockChain};
use std::{path::Path, sync::Arc};

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

    // Create bank account storage slots
    let initialized_slot =
        StorageSlotName::new("miden::component::miden_bank_account::initialized")
            .expect("Valid slot name");
    let balances_slot =
        StorageSlotName::new("miden::component::miden_bank_account::balances")
            .expect("Valid slot name");

    let bank_cfg = AccountCreationConfig {
        storage_slots: vec![
            StorageSlot::with_value(initialized_slot.clone(), Word::default()),
            StorageSlot::with_map(
                balances_slot,
                StorageMap::with_entries([]).expect("Empty storage map"),
            ),
        ],
        ..Default::default()
    };

    let mut bank_account =
        create_testing_account_from_package(bank_package.clone(), bank_cfg).await?;

    // Verify bank starts uninitialized
    let before = bank_account.storage().get_item(&initialized_slot)?;
    assert_eq!(before[0].as_int(), 0, "Bank should start uninitialized");
    println!("Before init: initialized = {}", before[0].as_int());

    // Build mock chain
    let mut builder = MockChain::builder();
    builder.add_existing_basic_faucet(Auth::BasicAuth, "TEST", 10_000_000, Some(10))?;
    builder.add_account(bank_account.clone())?;
    let mut mock_chain = builder.build()?;

    // Execute init transaction script
    let init_program = init_tx_script_package.unwrap_program();
    let init_tx_script = TransactionScript::new((*init_program).clone());

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
    assert_eq!(after[0].as_int(), 1, "Bank should be initialized after running init tx script");
    println!("After init: initialized = {}", after[0].as_int());

    println!("\nInit test passed!");
    Ok(())
}
