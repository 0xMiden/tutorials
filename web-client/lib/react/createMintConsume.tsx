'use client';

import {
  MidenProvider,
  useMiden,
  useCreateWallet,
  useCreateFaucet,
  useMint,
  useConsume,
  useSend,
} from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import { tutorialNetwork } from '../feeSupport';
import {
  TutorialButton,
  tutorialAuthScheme,
  useTutorialSupport,
} from './tutorialSupport';

function CreateMintConsumeInner() {
  const { sync } = useMiden();
  const { createWallet } = useCreateWallet();
  const { createFaucet } = useCreateFaucet();
  const { mint } = useMint();
  const { consume } = useConsume();
  const { send } = useSend();
  const {
    fundAccount,
    committed,
    waitForTokenNotes,
    waitForNote,
    assertBalance,
  } = useTutorialSupport();

  const run = async () => {
    console.log('Synchronizing before creating accounts…');
    await sync();
    console.log('Creating Alice with useCreateWallet…');
    const authScheme = await tutorialAuthScheme();
    // Native fee tokens and the tutorial's MID token are separate assets.
    const alice = await createWallet({
      storageMode: StorageMode.Public,
      authScheme,
    });
    console.log('Alice ID:', alice.id().toString());
    await fundAccount(alice);

    // v0.17 faucets include BasicWallet, so they can receive fee funding.
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
      amount: BigInt(1000),
      noteType: NoteVisibility.Public,
    });
    await committed(minted.transactionId);
    const notes = await waitForTokenNotes(alice, faucet);
    const consumed = await consume({ accountId: alice.id().toString(), notes });
    await committed(consumed.transactionId);
    await assertBalance(alice, faucet, BigInt(1000));

    const bob = await createWallet({
      storageMode: StorageMode.Public,
      authScheme,
    });
    const sent = await send({
      from: alice,
      to: bob,
      assetId: faucet,
      amount: BigInt(100),
      noteType: NoteVisibility.Public,
      returnNote: true,
    });
    await committed(sent.txId);
    if (!sent.note) throw new Error('Send did not return its output note');
    await waitForNote(sent.note.id().toString());
    await assertBalance(alice, faucet, BigInt(900));
    console.log('Tokens sent successfully!');
  };

  return (
    <TutorialButton
      name="createMintConsume"
      label="Run: Create, Mint, Consume & Send"
      run={run}
    />
  );
}

export default function CreateMintConsume() {
  return (
    <MidenProvider
      config={{
        rpcUrl: tutorialNetwork(),
        prover: tutorialNetwork(),
        autoSyncInterval: 0,
      }}
    >
      <CreateMintConsumeInner />
    </MidenProvider>
  );
}
