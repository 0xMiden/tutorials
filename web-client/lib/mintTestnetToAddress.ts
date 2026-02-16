/**
 * Mint 100 MIDEN tokens on testnet to a fixed recipient using a local prover.
 */
export async function mintTestnetToAddress(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('Run in browser');
    return;
  }

  const {
    WebClient,
    AccountStorageMode,
    AuthScheme,
    Address,
    NoteType,
    TransactionProver,
  } = await import('@miden-sdk/miden-sdk');

  const client = await WebClient.createClient('https://rpc.testnet.miden.io');
  const prover = TransactionProver.newLocalProver();

  console.log('Latest block:', (await client.syncState()).blockNum());

  // ── Create a faucet ────────────────────────────────────────────────────────
  console.log('Creating faucet...');
  const faucet = await client.newFaucet(
    AccountStorageMode.public(),
    false,
    'MID',
    8,
    BigInt(1_000_000),
    AuthScheme.AuthRpoFalcon512,
  );
  console.log('Faucet ID:', faucet.id().toString());
  await client.syncState();

  // ── Mint to recipient ───────────────────────────────────────────────────────
  const recipientAddress =
    'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6_qruqqypuyph';
  const recipientAccountId = Address.fromBech32(recipientAddress).accountId();
  console.log('Recipient account ID:', recipientAccountId.toString());

  console.log('Minting 100 MIDEN tokens...');
  const txResult = await client.executeTransaction(
    faucet.id(),
    client.newMintTransactionRequest(
      recipientAccountId,
      faucet.id(),
      NoteType.Public,
      BigInt(100),
    ),
  );
  const proven = await client.proveTransaction(txResult, prover);
  const submissionHeight = await client.submitProvenTransaction(
    proven,
    txResult,
  );
  const txExecutionResult = await client.applyTransaction(
    txResult,
    submissionHeight,
  );

  console.log('Waiting for settlement...');
  await new Promise((resolve) => setTimeout(resolve, 7_000));
  await client.syncState();

  const txId = txExecutionResult.executedTransaction().id().toHex().toString();
  console.log('Mint tx id:', txId);
  console.log('Mint complete.');
}
