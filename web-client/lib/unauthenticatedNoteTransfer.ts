/**
 * Demonstrates unauthenticated note transfer chain using a local prover on the Miden Network
 * Creates a chain of P2ID (Pay to ID) notes: Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
 *
 * @throws {Error} If the function cannot be executed in a browser environment
 */
export async function unauthenticatedNoteTransfer(): Promise<void> {
  // Ensure this runs only in a browser context
  if (typeof window === 'undefined') return console.warn('Run in browser');

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

  // ── Creating new account ──────────────────────────────────────────────────────
  console.log('Creating accounts');

  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    type: AccountType.MutableWallet,
    storage: StorageMode.Public,
  });
  console.log('Alice account ID:', alice.id().toString());

  const wallets = [];
  for (let i = 0; i < 5; i++) {
    const wallet = await client.accounts.create({
      type: AccountType.MutableWallet,
      storage: StorageMode.Public,
    });
    wallets.push(wallet);
    console.log('wallet ', i.toString(), wallet.id().toString());
  }

  // ── Creating new faucet ──────────────────────────────────────────────────────
  const faucet = await client.accounts.create({
    type: AccountType.FungibleFaucet,
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());

  // ── mint 10 000 MID to Alice ──────────────────────────────────────────────────────
  const mintTxId = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(10_000),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for settlement');
  await client.transactions.waitFor(mintTxId);
  await client.sync();

  // ── Consume the freshly minted note ──────────────────────────────────────────────
  const noteList = await client.notes.listAvailable({ account: alice });
  await client.transactions.consume({
    account: alice,
    notes: noteList.map((n) => n.inputNoteRecord()),
  });
  await client.sync();

  // ── Create unauthenticated note transfer chain ─────────────────────────────────────────────
  // Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
  for (let i = 0; i < wallets.length; i++) {
    console.log(`\nUnauthenticated tx ${i + 1}`);

    const sender = i === 0 ? alice : wallets[i - 1];
    const receiver = wallets[i];

    console.log('Sender:', sender.id().toString());
    console.log('Receiver:', receiver.id().toString());

    const { note } = await client.transactions.send({
      account: sender,
      to: receiver,
      token: faucet,
      amount: BigInt(50),
      type: NoteVisibility.Public,
      authenticated: false,
    });

    const consumeTxId = await client.transactions.consume({
      account: receiver,
      notes: [note],
    });

    console.log(
      `Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/${consumeTxId.toHex()}`,
    );
  }

  console.log('Asset transfer chain completed ✅');
}
