/**
 * Demonstrates unauthenticated note transfer chain using a local prover on the Miden Network
 * Creates a chain of P2ID (Pay to ID) notes: Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
 *
 * @throws {Error} If the function cannot be executed in a browser environment
 */
import { MidenClient, AccountType, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

export async function unauthenticatedNoteTransfer(): Promise<void> {
  // Ensure this runs only in a browser context
  if (typeof window === 'undefined') return console.warn('Run in browser');

  await MidenClient.ready();

  const client = await MidenClient.create({
    rpcUrl: 'https://rpc.testnet.miden.io',
  });

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Creating new account ──────────────────────────────────────────────────────
  console.log('Creating accounts');

  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    type: AccountType.RegularAccountUpdatableCode,
    storage: StorageMode.Public,
  });
  console.log('Alice account ID:', alice.id().toString());

  const wallets = [];
  for (let i = 0; i < 5; i++) {
    const wallet = await client.accounts.create({
      type: AccountType.RegularAccountUpdatableCode,
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
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(10_000),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for settlement');
  await client.transactions.waitFor(mintTxId);

  // ── Consume the freshly minted note ──────────────────────────────────────────────
  await client.transactions.consumeAll({
    account: alice,
  });

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
      returnNote: true,
    });

    const { txId: consumeTxId } = await client.transactions.consume({
      account: receiver,
      notes: [note],
    });

    console.log(
      `Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/${consumeTxId.toHex()}`,
    );
  }

  console.log('Asset transfer chain completed ✅');
}
