use std::time::Duration;

use miden_client::{
    keystore::FilesystemKeyStore,
    store::TransactionFilter,
    transaction::{TransactionId, TransactionStatus},
    Client, ClientError,
};
use tokio::time::sleep;

/// Waits until the specified transaction is committed, syncing the client between polls.
pub async fn wait_for_tx(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: TransactionId,
) -> Result<(), ClientError> {
    loop {
        client.sync_state().await?;

        let txs = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        let tx_committed = txs
            .first()
            .is_some_and(|tx| matches!(tx.status, TransactionStatus::Committed { .. }));

        if tx_committed {
            println!("✅ transaction {} committed", tx_id.to_hex());
            break;
        }

        println!(
            "Transaction {} not yet committed. Waiting...",
            tx_id.to_hex()
        );
        sleep(Duration::from_secs(2)).await;
    }

    Ok(())
}
