// lib/createMintConsume.ts
import { MidenClient, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

export async function createMintConsume(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  await MidenClient.ready();

  const client = await MidenClient.create({
    rpcUrl: 'https://rpc.testnet.miden.io',
  });

  // 1. Sync with the latest blockchain state
  const state = await client.sync();
  console.log('Latest block number:', state.blockNum());

  // 2. Create Alice's account
  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log('Alice ID:', alice.id().toString());

  // 3. Deploy a fungible faucet
  console.log('Creating faucet…');
  const faucet = await client.accounts.create({
    type: 0, // 0 = FungibleFaucet
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());

  // 4. Mint tokens to Alice
  console.log('Minting tokens to Alice...');
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(1000),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for transaction confirmation...');
  await client.transactions.waitFor(mintTxId);

  // 5-6. Consume all available notes for Alice
  console.log('Consuming minted notes...');
  await client.transactions.consumeAll({
    account: alice,
  });

  console.log('Notes consumed.');

  // 7. Send tokens to Bob (create a fresh recipient account to send to)
  console.log("Creating account for Bob…");
  const bob = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log('Bob ID:', bob.id().toString());
  console.log("Sending tokens to Bob's account...");
  await client.transactions.send({
    account: alice,
    to: bob,
    token: faucet,
    amount: BigInt(100),
    type: NoteVisibility.Public,
  });
  console.log('Tokens sent successfully!');
}
