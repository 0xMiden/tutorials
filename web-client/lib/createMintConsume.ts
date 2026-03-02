// lib/createMintConsume.ts
export async function createMintConsume(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  // dynamic import → only in the browser, so WASM is loaded client‑side
  const { MidenClient, AccountType, NoteVisibility, StorageMode } = await import('@miden-sdk/miden-sdk');

  const client = await MidenClient.create({
    rpcUrl: 'http://localhost:57291',
  });

  // 1. Sync with the latest blockchain state
  const state = await client.sync();
  console.log('Latest block number:', state.blockNum());

  // 2. Create Alice's account
  console.log('Creating account for Alice…');
  const alice = await client.accounts.create({
    type: AccountType.MutableWallet,
    storage: StorageMode.Public,
  });
  console.log('Alice ID:', alice.id().toString());

  // 3. Deploy a fungible faucet
  console.log('Creating faucet…');
  const faucet = await client.accounts.create({
    type: AccountType.FungibleFaucet,
    symbol: 'MID',
    decimals: 8,
    maxSupply: BigInt(1_000_000),
    storage: StorageMode.Public,
  });
  console.log('Faucet ID:', faucet.id().toString());

  // 4. Mint tokens to Alice
  console.log('Minting tokens to Alice...');
  const mintTxId = await client.transactions.mint({
    account: faucet,
    to: alice,
    amount: BigInt(1000),
    type: NoteVisibility.Public,
  });

  console.log('Waiting for transaction confirmation...');
  await client.transactions.waitFor(mintTxId);

  // 5. Fetch minted notes
  const mintedNotes = await client.notes.listAvailable({ account: alice });
  console.log(
    'Minted notes:',
    mintedNotes.map((n) => n.id().toString()),
  );

  // 6. Consume minted notes
  console.log('Consuming minted notes...');
  await client.transactions.consume({
    account: alice,
    notes: mintedNotes,
  });

  console.log('Notes consumed.');

  // 7. Send tokens to Bob
  const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6_qruqqypuyph';
  console.log("Sending tokens to Bob's account...");
  await client.transactions.send({
    account: alice,
    to: bobAddress,
    token: faucet,
    amount: BigInt(100),
    type: NoteVisibility.Public,
  });
  console.log('Tokens sent successfully!');
}
