// Documentation-only example for the "Creating Multiple Notes" tutorial.
// This component is embedded in docs via CodeSdkTabs and is not wired into the
// test harness (app/page.tsx). The TypeScript equivalent in
// lib/multiSendWithDelegatedProver.ts is used for Playwright tests instead.
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useMultiSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

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
    const alice = await createWallet({ storageMode: StorageMode.Public });
    console.log('Alice account ID:', alice.id().toString());

    // 2. Deploy a fungible faucet
    const faucet = await createFaucet({
      tokenSymbol: 'MID',
      decimals: 8,
      maxSupply: BigInt(1_000_000),
      storageMode: StorageMode.Public,
    });
    console.log('Faucet ID:', faucet.id().toString());

    // 3. Mint 10,000 MID to Alice
    const mintResult = await mint({
      faucetId: faucet,
      targetAccountId: alice,
      amount: BigInt(10_000),
      noteType: NoteVisibility.Public,
    });

    console.log('Waiting for settlement…');
    await waitForCommit(mintResult.transactionId);

    // 4. Consume the freshly minted notes
    const notes = await waitForConsumableNotes({ accountId: alice });
    await consume({ accountId: alice.id().toString(), notes });

    // 5. Create three recipient wallets, then send 100 MID to each in a single transaction
    const recipients = [];
    for (let i = 0; i < 3; i++) {
      const recipient = await createWallet({ storageMode: StorageMode.Public });
      recipients.push(recipient);
      console.log(`Recipient ${i + 1} ID:`, recipient.id().toString());
    }

    await sendMany({
      from: alice,
      assetId: faucet,
      recipients: recipients.map((recipient) => ({ to: recipient, amount: BigInt(100) })),
      noteType: NoteVisibility.Public,
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
