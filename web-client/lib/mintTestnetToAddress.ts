/**
 * Mint 100 MIDEN tokens on testnet to a fixed recipient using a local prover.
 */
export async function mintTestnetToAddress(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('Run in browser');
    return;
  }

  const {
    MidenClient,
    AccountType,
    NoteVisibility,
    StorageMode,
  } = await import('@miden-sdk/miden-sdk');

  const client = await MidenClient.create({
    rpcUrl: 'local',
    proverUrl: 'local',
  });

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Create a faucet ────────────────────────────────────────────────────────
  console.log('Creating faucet...');
  const faucet = await client.accounts.create({
    type: AccountType.FungibleFaucet,
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());

  // ── Mint to recipient ───────────────────────────────────────────────────────
  const recipientAddress =
    'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6_qruqqypuyph';
  console.log('Recipient address:', recipientAddress);

  console.log('Minting 100 MIDEN tokens...');
  const mintTxId = await client.transactions.mint({
    account: faucet,
    to: recipientAddress,
    amount: BigInt(100),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for settlement...');
  await client.transactions.waitFor(mintTxId);

  console.log('Mint tx id:', mintTxId.toHex());
  console.log('Mint complete.');
}
