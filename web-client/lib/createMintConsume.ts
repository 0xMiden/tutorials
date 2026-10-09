// lib/createMintConsume.ts
import { FaucetType, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
  consumeAllFeeAware,
  createTutorialClient,
  fundAccountForFees,
} from './feeSupport';

export async function createMintConsume(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  const client = await createTutorialClient();

  // 1. Sync with the latest blockchain state
  const state = await client.sync();
  console.log('Latest block number:', state.blockNum());

  // 2. Create Alice's account
  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log('Alice ID:', alice.id().toString());

  // 3. Create our own fungible faucet. SDK v0.17 includes BasicWallet,
  // allowing both accounts to consume native fee funding before minting MID.
  console.log('Creating faucet…');
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

  // 4. Mint tokens to Alice.
  console.log('Minting tokens to Alice...');
  await client.sync();
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(1000),
    type: NoteVisibility.Public,
  });
  console.log('Waiting for transaction confirmation...');
  await client.transactions.waitFor(mintTxId, { timeout: 120_000 });

  // 5-6. Consume all available notes for Alice.
  console.log('Consuming minted notes...');
  await consumeAllFeeAware(client, alice);

  console.log('Notes consumed.');

  // 7. Send tokens to Bob
  const bob = await client.accounts.create({
    storage: StorageMode.Public,
  });
  console.log("Sending tokens to Bob's account...");
  await client.sync();
  const { txId: sendTxId } = await client.transactions.send({
    account: alice,
    to: bob,
    token: faucet,
    amount: BigInt(100),
    type: NoteVisibility.Public,
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log(`Transaction committed: ${sendTxId.toHex()}`);
  const updatedAlice = await client.accounts.get(alice);
  const balance = updatedAlice?.vault().getBalance(faucet.id());
  if (balance !== BigInt(900))
    throw new Error(`Expected Alice to retain 900 MID, got ${balance}`);
  console.log('Tokens sent successfully!');
}
