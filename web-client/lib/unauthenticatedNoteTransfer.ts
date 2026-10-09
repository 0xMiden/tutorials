/**
 * Demonstrates unauthenticated note transfer chain against the configured Miden network
 * Creates a chain of P2ID (Pay to ID) notes: Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
 *
 * @throws {Error} If the function cannot be executed in a browser environment
 */
import { FaucetType, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
  consumeAllFeeAware,
  createTutorialClient,
  fundAccountForFees,
  tutorialExplorerUrl,
} from './feeSupport';

export async function unauthenticatedNoteTransfer(): Promise<void> {
  // Ensure this runs only in a browser context
  if (typeof window === 'undefined') return console.warn('Run in browser');

  const client = await createTutorialClient();

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Creating new account ──────────────────────────────────────────────────────
  console.log('Creating accounts');

  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log('Alice account ID:', alice.id().toString());

  const wallets = [];
  for (let i = 0; i < 5; i++) {
    const wallet = await client.accounts.create({
      storage: StorageMode.Public,
    });
    wallets.push(wallet);
    console.log('wallet ', i.toString(), wallet.id().toString());
  }

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

  await client.sync();
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(10_000),
    type: NoteVisibility.Public,
  });
  console.log('Waiting for settlement');
  await client.transactions.waitFor(mintTxId, { timeout: 120_000 });
  await consumeAllFeeAware(client, alice);

  for (const wallet of wallets) {
    await fundAccountForFees(client, wallet);
  }

  // ── Create unauthenticated note transfer chain ─────────────────────────────────────────────
  // Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
  for (let i = 0; i < wallets.length; i++) {
    console.log(`\nUnauthenticated tx ${i + 1}`);

    const sender = i === 0 ? alice : wallets[i - 1];
    const receiver = wallets[i];

    console.log('Sender:', sender.id().toString());
    console.log('Receiver:', receiver.id().toString());

    await client.sync();
    const { note, txId: sendTxId } = await client.transactions.send({
      account: sender,
      to: receiver,
      token: faucet,
      amount: BigInt(50),
      type: NoteVisibility.Public,
      returnNote: true,
      waitForConfirmation: false,
    });

    // Pass the full note before waiting for the sender's transaction.
    await client.sync();
    const { txId: consumeTxId } = await client.transactions.consume({
      account: receiver,
      notes: [note],
      waitForConfirmation: true,
      timeout: 120_000,
    });
    await client.transactions.waitFor(sendTxId, { timeout: 120_000 });
    console.log(`Transaction committed: ${consumeTxId.toHex()}`);

    console.log(
      `Consumed Note Tx on MidenScan: ${tutorialExplorerUrl()}/tx/${consumeTxId.toHex()}`,
    );
  }

  const lastWallet = await client.accounts.get(wallets[wallets.length - 1]);
  const balance = lastWallet?.vault().getBalance(faucet.id());
  if (balance !== BigInt(50))
    throw new Error(`Expected last wallet to hold 50 MID, got ${balance}`);
  console.log('Asset transfer chain completed ✅');
}
