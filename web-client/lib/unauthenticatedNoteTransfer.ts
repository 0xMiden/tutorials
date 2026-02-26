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
    TransactionProver,
    Note,
    NoteType,
    NoteAssets,
    OutputNoteArray,
    FungibleAsset,
    NoteAndArgsArray,
    NoteAndArgs,
    NoteAttachment,
    TransactionRequestBuilder,
    OutputNote,
  } = await import('@miden-sdk/miden-sdk');

  const client = await MidenClient.create({
    rpcUrl: 'http://localhost:57291',
  });
  const prover = TransactionProver.newLocalProver();

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
    prover,
  });

  console.log('Waiting for settlement');
  await client.transactions.waitFor(mintTxId);
  await client.sync();

  // ── Consume the freshly minted note ──────────────────────────────────────────────
  const noteList = await client.notes.listAvailable({ account: alice });
  await client.transactions.consume({
    account: alice,
    notes: noteList.map((n) => n.inputNoteRecord()),
    prover,
  });
  await client.sync();

  // ── Create unauthenticated note transfer chain ─────────────────────────────────────────────
  // Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
  for (let i = 0; i < wallets.length; i++) {
    console.log(`\nUnauthenticated tx ${i + 1}`);

    // Determine sender and receiver for this iteration
    const sender = i === 0 ? alice : wallets[i - 1];
    const receiver = wallets[i];

    console.log('Sender:', sender.id().toString());
    console.log('Receiver:', receiver.id().toString());

    const assets = new NoteAssets([new FungibleAsset(faucet.id(), BigInt(50))]);
    const p2idNote = Note.createP2IDNote(
      sender.id(),
      receiver.id(),
      assets,
      NoteType.Public,
      new NoteAttachment(),
    );

    const outputP2ID = OutputNote.full(p2idNote);

    console.log('Creating P2ID note...');
    {
      const builder = new TransactionRequestBuilder();
      const request = builder.withOwnOutputNotes(new OutputNoteArray([outputP2ID])).build();
      await client.transactions.submit(sender, request, { prover });
    }

    console.log('Consuming P2ID note...');

    const noteIdAndArgs = new NoteAndArgs(p2idNote, null);

    const consumeBuilder = new TransactionRequestBuilder();
    const consumeRequest = consumeBuilder.withInputNotes(new NoteAndArgsArray([noteIdAndArgs])).build();

    {
      const txId = await client.transactions.submit(
        receiver,
        consumeRequest,
        { prover },
      );

      console.log(
        `Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/${txId.toHex()}`,
      );
    }
  }

  console.log('Asset transfer chain completed ✅');
}
