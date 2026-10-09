'use client';

import {
  MidenProvider,
  useMiden,
  useCreateWallet,
  useCreateFaucet,
  useMint,
  useConsume,
  useSend,
  type Account,
} from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import { tutorialExplorerUrl, tutorialNetwork } from '../feeSupport';
import {
  TutorialButton,
  tutorialAuthScheme,
  useTutorialSupport,
} from './tutorialSupport';

function UnauthenticatedNoteTransferInner() {
  const { sync } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { send } = useSend();
  const { fundAccount, committed, waitForTokenNotes, assertBalance } =
    useTutorialSupport();

  const run = async () => {
    await sync();
    const authScheme = await tutorialAuthScheme();
    const alice = await createWallet({
      storageMode: StorageMode.Public,
      authScheme,
    });
    console.log('Alice ID:', alice.id().toString());
    await fundAccount(alice);
    const wallets: Account[] = [];
    for (let index = 0; index < 5; index += 1) {
      const wallet = await createWallet({
        storageMode: StorageMode.Public,
        authScheme,
      });
      console.log(`Wallet ${index}:`, wallet.id().toString());
      // Every recipient pays fees when consuming and forwarding the note.
      await fundAccount(wallet);
      wallets.push(wallet);
    }
    const faucet = await createFaucet({
      tokenSymbol: 'MID',
      decimals: 8,
      maxSupply: BigInt(1_000_000),
      storageMode: StorageMode.Public,
      authScheme,
    });
    console.log('Faucet ID:', faucet.id().toString());
    await fundAccount(faucet);
    await sync();
    const minted = await mint({
      faucetId: faucet,
      targetAccountId: alice,
      amount: BigInt(10_000),
      noteType: NoteVisibility.Public,
    });
    await committed(minted.transactionId);
    const notes = await waitForTokenNotes(alice, faucet);
    const consumed = await consume({ accountId: alice.id().toString(), notes });
    await committed(consumed.transactionId);

    // Pass full Note objects directly, without fetching an inclusion proof.
    let currentSender = alice;
    for (let index = 0; index < wallets.length; index += 1) {
      const wallet = wallets[index];
      const sent = await send({
        from: currentSender,
        to: wallet,
        assetId: faucet,
        amount: BigInt(50),
        noteType: NoteVisibility.Public,
        returnNote: true,
      });
      if (!sent.note) throw new Error('Send did not return its output note');
      const received = await consume({
        accountId: wallet.id().toString(),
        notes: [sent.note],
      });
      await committed(sent.txId);
      await committed(received.transactionId);
      await assertBalance(wallet, faucet, BigInt(50));
      console.log(
        `Transfer ${index + 1}: ${tutorialExplorerUrl()}/tx/${received.transactionId}`,
      );
      currentSender = wallet;
    }
    await assertBalance(alice, faucet, BigInt(9950));
    for (const wallet of wallets.slice(0, -1))
      await assertBalance(wallet, faucet, BigInt(0));
    console.log('Asset transfer chain completed ✅');
  };

  return (
    <TutorialButton
      name="unauthenticatedNoteTransfer"
      label="Run: Unauthenticated Note Transfer"
      run={run}
    />
  );
}

export default function UnauthenticatedNoteTransfer() {
  return (
    <MidenProvider
      config={{
        rpcUrl: tutorialNetwork(),
        prover: tutorialNetwork(),
        autoSyncInterval: 0,
      }}
    >
      <UnauthenticatedNoteTransferInner />
    </MidenProvider>
  );
}
