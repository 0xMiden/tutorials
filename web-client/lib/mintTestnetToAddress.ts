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
    Address,
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
  await client.sync();

  // ── Mint to recipient ───────────────────────────────────────────────────────
  const recipientAddress =
    'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6_qruqqypuyph';
  const recipientAccountId = Address.fromBech32(recipientAddress).accountId();
  console.log('Recipient account ID:', recipientAccountId.toString());

  console.log('Minting 100 MIDEN tokens...');
  const mintTxId = await client.transactions.mint({
    account: faucet,
    to: recipientAccountId,
    amount: BigInt(100),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for settlement...');
  await client.transactions.waitFor(mintTxId);
  await client.sync();

  console.log('Mint tx id:', mintTxId.toHex());
  console.log('Mint complete.');
}
