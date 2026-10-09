/**
 * Demonstrates multi-send functionality with delegated proving on the Miden Network
 * Creates multiple P2ID (Pay to ID) notes for different recipients
 *
 * @throws {Error} If the function cannot be executed in a browser environment
 */
import {
  NoteArray,
  NoteVisibility,
  FaucetType,
  StorageMode,
  createP2IDNote,
} from '@miden-sdk/miden-sdk/lazy';
import {
  consumeAllFeeAware,
  createTutorialClient,
  fundAccountForFees,
} from './feeSupport';

export async function multiSendWithDelegatedProver(): Promise<void> {
  // Ensure this runs only in a browser context
  if (typeof window === 'undefined') return console.warn('Run in browser');

  const client = await createTutorialClient();

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Creating new account ──────────────────────────────────────────────────────
  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log('Alice account ID:', alice.id().toString());

  // ── Creating new faucet ────────────────────────────────────────────────────
  const faucet = await client.accounts.create({
    type: FaucetType.FungibleFaucet,
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());
  await fundAccountForFees(client, alice);
  await fundAccountForFees(client, faucet);

  // ── mint 10 000 MID to Alice ───────────────────────────────────────────────
  await client.sync();
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(10_000),
    type: NoteVisibility.Public,
  });
  console.log('waiting for settlement');
  await client.transactions.waitFor(mintTxId, { timeout: 120_000 });
  await consumeAllFeeAware(client, alice);

  // ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
  const recipients = await Promise.all(
    Array.from({ length: 3 }, () =>
      client.accounts.create({ storage: StorageMode.Public }),
    ),
  );
  const recipientAddresses = recipients.map((account) =>
    account.id().toString(),
  );

  const p2idNotes = recipientAddresses.map((addr) =>
    createP2IDNote({
      from: alice,
      to: addr,
      assets: { token: faucet, amount: BigInt(100) },
      type: NoteVisibility.Public,
    }),
  );

  // ── create all P2ID notes ───────────────────────────────────────────────────────────────
  await client.sync();
  const builder = await client.feeAwareTransactionRequestBuilder(alice);
  const outputs = new NoteArray();
  for (const note of p2idNotes) outputs.push(note);
  const request = builder.withOwnOutputNotes(outputs).build();
  const { txId } = await client.transactions.submit(alice, request);
  await client.transactions.waitFor(txId, { timeout: 120_000 });
  console.log(`Transaction committed: ${txId.toHex()}`);
  const updatedAlice = await client.accounts.get(alice);
  const balance = updatedAlice?.vault().getBalance(faucet.id());
  if (balance !== BigInt(9_700))
    throw new Error(`Expected Alice to retain 9700 MID, got ${balance}`);

  console.log('All notes created ✅');
}
