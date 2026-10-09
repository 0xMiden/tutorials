/**
 * Mint 100 MID base units on the configured network to a newly created recipient.
 * Uses testnet unless another network is configured explicitly.
 */
import { FaucetType, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
  createTutorialClient,
  fundAccountForFees,
} from './feeSupport';

export async function mintTestnetToAddress(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('Run in browser');
    return;
  }

  const client = await createTutorialClient();

  console.log('Latest block:', (await client.sync()).blockNum());

  // ── Create a faucet ────────────────────────────────────────────────────────
  console.log('Creating faucet...');
  const faucet = await client.accounts.create({
    type: FaucetType.FungibleFaucet,
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());
  await fundAccountForFees(client, faucet);

  // ── Mint to recipient ───────────────────────────────────────────────────────
  const recipient = await client.accounts.create({
    storage: StorageMode.Public,
  });
  const recipientAddress = recipient.id().toString();
  console.log('Recipient address:', recipientAddress);

  console.log('Minting 100 MID base units...');
  await client.sync();
  const { txId: mintTxId } = await client.transactions.mint({
    account: faucet,
    to: recipient,
    amount: BigInt(100),
    type: NoteVisibility.Public,
  });

  await client.transactions.waitFor(mintTxId, { timeout: 120_000 });
  console.log('Mint tx id:', mintTxId.toHex());
  console.log('Mint complete.');
}
