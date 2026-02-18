// Documentation-only example for the "Creating Multiple Notes" tutorial.
// This component is embedded in docs via CodeSdkTabs and is not wired into the
// test harness (app/page.tsx). The TypeScript equivalent in
// lib/multiSendWithDelegatedProver.ts is used for Playwright tests instead.
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useMultiSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react';

function MultiSendInner() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { sendMany } = useMultiSend();
  const { waitForCommit } = useWaitForCommit();
  const { waitForConsumableNotes } = useWaitForNotes();

  const run = async () => {
    // 1. Create Alice's wallet
    console.log('Creating account for Alice…');
    const alice = await createWallet({ storageMode: 'public' });
    const aliceId = alice.id().toString();
    console.log('Alice account ID:', aliceId);

    // 2. Deploy a fungible faucet
    const faucet = await createFaucet({
      tokenSymbol: 'MID',
      decimals: 8,
      maxSupply: BigInt(1_000_000),
      storageMode: 'public',
    });
    const faucetId = faucet.id().toString();
    console.log('Faucet ID:', faucetId);

    // 3. Mint 10,000 MID to Alice
    const mintResult = await mint({
      faucetId,
      targetAccountId: aliceId,
      amount: BigInt(10_000),
      noteType: 'public',
    });

    console.log('Waiting for settlement…');
    await waitForCommit(mintResult.transactionId);

    // 4. Consume the freshly minted notes
    const notes = await waitForConsumableNotes({ accountId: aliceId });
    const noteIds = notes.map((n) => n.inputNoteRecord().id().toString());
    await consume({ accountId: aliceId, noteIds });

    // 5. Send 100 MID to three recipients in a single transaction
    await sendMany({
      from: aliceId,
      assetId: faucetId,
      recipients: [
        { to: 'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04', amount: BigInt(100) },
        { to: 'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn', amount: BigInt(100) },
        { to: 'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd', amount: BigInt(100) },
      ],
      noteType: 'public',
    });

    console.log('All notes created ✅');
  };

  return (
    <div>
      <button onClick={run} disabled={!isReady}>
        {isReady ? 'Run: Multi-Send with Delegated Proving' : 'Initializing…'}
      </button>
    </div>
  );
}

export default function MultiSendWithDelegatedProver() {
  return (
    <MidenProvider config={{ rpcUrl: 'testnet', prover: 'testnet' }}>
      <MultiSendInner />
    </MidenProvider>
  );
}
