// Documentation-only example for the "Mint, Consume, and Create Notes" tutorial.
// This component is embedded in docs via CodeSdkTabs and is not wired into the
// test harness (app/page.tsx). The TypeScript equivalent in lib/createMintConsume.ts
// is used for Playwright tests instead.
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk';

function CreateMintConsumeInner() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { send } = useSend();
  const { waitForCommit } = useWaitForCommit();
  const { waitForConsumableNotes } = useWaitForNotes();

  const run = async () => {
    // 1. Create Alice's wallet (public, mutable)
    console.log('Creating account for Alice…');
    const alice = await createWallet({ storageMode: StorageMode.Public });
    console.log('Alice ID:', alice.id().toString());

    // 2. Deploy a fungible faucet
    console.log('Creating faucet…');
    const faucet = await createFaucet({
      tokenSymbol: 'MID',
      decimals: 8,
      maxSupply: BigInt(1_000_000),
      storageMode: StorageMode.Public,
    });
    console.log('Faucet ID:', faucet.id().toString());

    // 3. Mint 1000 tokens to Alice
    console.log('Minting tokens to Alice...');
    const mintResult = await mint({
      faucetId: faucet,
      targetAccountId: alice,
      amount: BigInt(1000),
      noteType: NoteVisibility.Public,
    });
    console.log('Mint tx:', mintResult.transactionId);

    // 4. Wait for the mint transaction to be committed
    await waitForCommit(mintResult.transactionId);

    // 5. Wait for consumable notes to appear
    const notes = await waitForConsumableNotes({ accountId: alice });
    console.log('Consumable notes:', notes.length);

    // 6. Consume minted notes
    console.log('Consuming minted notes...');
    await consume({ accountId: alice, notes });
    console.log('Notes consumed.');

    // 7. Send 100 tokens to Bob
    const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6_qruqqypuyph';
    console.log("Sending tokens to Bob's account...");
    await send({
      from: alice,
      to: bobAddress,
      assetId: faucet,
      amount: BigInt(100),
      noteType: NoteVisibility.Public,
    });
    console.log('Tokens sent successfully!');
  };

  return (
    <div>
      <button onClick={run} disabled={!isReady}>
        {isReady ? 'Run: Create, Mint, Consume & Send' : 'Initializing…'}
      </button>
    </div>
  );
}

export default function CreateMintConsume() {
  return (
    <MidenProvider config={{ rpcUrl: 'testnet', prover: 'local' }}>
      <CreateMintConsumeInner />
    </MidenProvider>
  );
}
