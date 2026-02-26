/**
 * Demonstrates multi-send functionality with delegated proving on the Miden Network
 * Creates multiple P2ID (Pay to ID) notes for different recipients
 *
 * @throws {Error} If the function cannot be executed in a browser environment
 */
export async function multiSendWithDelegatedProver(): Promise<void> {
  // Ensure this runs only in a browser context
  if (typeof window === 'undefined') return console.warn('Run in browser');

  const {
    MidenClient,
    AccountType,
    NoteVisibility,
    StorageMode,
    createP2IDNote,
    OutputNoteArray,
    TransactionRequestBuilder,
  } = await import('@miden-sdk/miden-sdk');

  const client = await MidenClient.create({
    rpcUrl: 'http://localhost:57291',
  });

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Creating new account ──────────────────────────────────────────────────────
  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    type: AccountType.MutableWallet,
    storage: StorageMode.Public,
  });
  console.log('Alice account ID:', alice.id().toString());

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

  console.log('waiting for settlement');
  await client.transactions.waitFor(mintTxId);
  await client.sync();

  // ── consume the freshly minted notes ──────────────────────────────────────────────
  const noteList = await client.notes.listAvailable({ account: alice });
  await client.transactions.consume({
    account: alice,
    notes: noteList.map((n) => n.inputNoteRecord()),
  });

  // ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
  const recipientAddresses = [
    'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04',
    'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn',
    'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd',
  ];

  const p2idNotes = recipientAddresses.map((addr) =>
    createP2IDNote({
      from: alice,
      to: addr,
      assets: { token: faucet, amount: BigInt(100) },
      type: NoteVisibility.Public,
    }),
  );

  // ── create all P2ID notes ───────────────────────────────────────────────────────────────
  const builder = new TransactionRequestBuilder();
  const txRequest = builder.withOwnOutputNotes(new OutputNoteArray(p2idNotes)).build();
  await client.transactions.submit(alice, txRequest);

  console.log('All notes created ✅');
}
