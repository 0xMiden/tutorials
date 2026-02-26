// Documentation-only example for the "Unauthenticated Note Transfer" tutorial.
// This component is embedded in docs via CodeSdkTabs and is not wired into the
// test harness (app/page.tsx). The TypeScript equivalent in
// lib/unauthenticatedNoteTransfer.ts is used for Playwright tests instead.
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useSend, useWaitForCommit, useWaitForNotes, type Account } from '@miden-sdk/react';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk';

function UnauthenticatedNoteTransferInner() {
  const { isReady } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { send } = useSend();
  const { waitForCommit } = useWaitForCommit();
  const { waitForConsumableNotes } = useWaitForNotes();

  const run = async () => {
    // 1. Create Alice and 5 wallets for the transfer chain
    console.log('Creating accounts…');
    const alice = await createWallet({ storageMode: StorageMode.Public });
    console.log('Alice account ID:', alice.id().toString());

    const wallets: Account[] = [];
    for (let i = 0; i < 5; i++) {
      const wallet = await createWallet({ storageMode: StorageMode.Public });
      wallets.push(wallet);
      console.log(`Wallet ${i}:`, wallet.id().toString());
    }

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
    const noteIds = notes.map((n) => n.inputNoteRecord().id());
    await consume({ accountId: alice, noteIds });

    // 5. Create the unauthenticated note transfer chain:
    //    Alice → Wallet 0 → Wallet 1 → Wallet 2 → Wallet 3 → Wallet 4
    console.log('Starting unauthenticated transfer chain…');
    let currentSender: Account = alice;
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const { note } = await send({
        from: currentSender,
        to: wallet,
        assetId: faucet,
        amount: BigInt(50),
        noteType: NoteVisibility.Public,
        authenticated: false,
      });

      const result = await consume({ accountId: wallet, noteIds: [note!] });
      console.log(
        `Transfer ${i + 1}: https://testnet.midenscan.com/tx/${result.transactionId}`,
      );

      currentSender = wallet;
    }

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
