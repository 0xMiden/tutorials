// Documentation-only example for the "Unauthenticated Note Transfer" tutorial.
// This component is embedded in docs via CodeSdkTabs and is not wired into the
// test harness (app/page.tsx). The TypeScript equivalent in
// lib/unauthenticatedNoteTransfer.ts is used for Playwright tests instead.
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useInternalTransfer, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react';

function UnauthenticatedNoteTransferInner() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { transferChain } = useInternalTransfer();
  const { waitForCommit } = useWaitForCommit();
  const { waitForConsumableNotes } = useWaitForNotes();

  const run = async () => {
    // 1. Create Alice and 5 wallets for the transfer chain
    console.log('Creating accounts…');
    const alice = await createWallet({ storageMode: 'public' });
    const aliceId = alice.id().toString();
    console.log('Alice account ID:', aliceId);

    const walletIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const wallet = await createWallet({ storageMode: 'public' });
      walletIds.push(wallet.id().toString());
      console.log(`Wallet ${i}:`, walletIds[i]);
    }

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

    // 5. Create the unauthenticated note transfer chain:
    //    Alice → Wallet 0 → Wallet 1 → Wallet 2 → Wallet 3 → Wallet 4
    console.log('Starting unauthenticated transfer chain…');
    const results = await transferChain({
      from: aliceId,
      recipients: walletIds,
      assetId: faucetId,
      amount: BigInt(50),
      noteType: 'public',
    });

    results.forEach((r, i) => {
      console.log(
        `Transfer ${i + 1}: https://testnet.midenscan.com/tx/${r.consumeTransactionId}`,
      );
    });

    console.log('Asset transfer chain completed ✅');
  };

  return (
    <div>
      <button onClick={run} disabled={!isReady}>
        {isReady ? 'Run: Unauthenticated Note Transfer' : 'Initializing…'}
      </button>
    </div>
  );
}

export default function UnauthenticatedNoteTransfer() {
  return (
    <MidenProvider config={{ rpcUrl: 'testnet', prover: 'local' }}>
      <UnauthenticatedNoteTransferInner />
    </MidenProvider>
  );
}
