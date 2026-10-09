'use client';

import { useState } from 'react';
import { useConsume, useMiden, useWaitForCommit } from '@miden-sdk/react/lazy';
import {
  Account,
  AccountId,
  getWasmOrThrow,
  type InputNoteRecord,
} from '@miden-sdk/miden-sdk/lazy';
import {
  assertNativeFundingNote,
  requestFundingNote,
  tutorialFeeConfig,
  tutorialNetwork,
} from '../feeSupport';

const SETTLEMENT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;

/** React wallet hooks expect the low-level numeric authentication enum. */
export async function tutorialAuthScheme() {
  const wasm = await getWasmOrThrow();
  return wasm.AuthScheme.AuthRpoFalcon512;
}

/** Uses the provider's actual client and hooks, not a second client. */
export function useTutorialSupport() {
  const { client, sync, runExclusive } = useMiden();
  const { consume } = useConsume();
  const { waitForCommit } = useWaitForCommit();

  const committed = async (transactionId: string) => {
    await waitForCommit(transactionId, {
      timeoutMs: SETTLEMENT_TIMEOUT_MS,
      intervalMs: POLL_INTERVAL_MS,
    });
    console.log(`Transaction committed: ${transactionId}`);
  };

  const waitForNote = async (noteId: string): Promise<InputNoteRecord> => {
    if (!client) throw new Error('Miden client is not ready');
    const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sync();
      const note = await runExclusive(() => client.getInputNote(noteId));
      if (note?.inclusionProof()) return note;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for committed note ${noteId}`);
  };

  const fundAccount = async (account: Account) => {
    if (!client) throw new Error('Miden client is not ready');
    await sync();
    const { faucetId, baseFee } = await runExclusive(() =>
      tutorialFeeConfig(client),
    );
    if (baseFee === 0) return;
    const updated = await runExclusive(() => client.getAccount(account.id()));
    if (!updated) throw new Error(`Account ${account.id()} is not in the local store`);
    if (updated.vault().getBalance(faucetId) > BigInt(0)) return;
    console.log(`Funding ${account.id()} with native ${tutorialNetwork()} fee tokens`);
    const minted = await requestFundingNote(account.id());
    console.log(`Funding note ${minted.note_id}`);
    const note = await waitForNote(minted.note_id);
    assertNativeFundingNote(note, faucetId);
    // The first transaction pays its fee from the native asset in the input note.
    await sync();
    const result = await consume({
      accountId: account.id().toString(),
      notes: [note],
    });
    await committed(result.transactionId);
  };

  const waitForTokenNotes = async (
    account: Account,
    faucet: Account,
  ): Promise<InputNoteRecord[]> => {
    if (!client) throw new Error('Miden client is not ready');
    const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sync();
      const records = await runExclusive(() =>
        client.getConsumableNotes(account.id()),
      );
      const notes = records
        .map((record) => record.inputNoteRecord())
        .filter(
          (record) =>
            // Globally consumable TX_FEE notes are not tutorial transfers.
            record.metadata()?.tag().asU32() !== 0xfee &&
            record.inclusionProof() &&
            record
              .details()
              .assets()
              .fungibleAssets()
              .some(
                (asset) =>
                  asset.faucetId().toString() === faucet.id().toString(),
              ),
        );
      if (notes.length > 0) return notes;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
      `No committed ${faucet.id()} token notes for ${account.id()}`,
    );
  };

  const assertBalance = async (
    account: Account,
    token: Account | AccountId,
    expected: bigint,
  ) => {
    if (!client) throw new Error('Miden client is not ready');
    await sync();
    const updated = await runExclusive(() => client.getAccount(account.id()));
    const actual = updated
      ?.vault()
      .getBalance(token instanceof Account ? token.id() : token);
    if (actual !== expected)
      throw new Error(
        `Balance mismatch for ${account.id()}: expected ${expected}, got ${actual}`,
      );
    console.log(`Verified balance ${account.id()}: ${actual}`);
  };

  return {
    committed,
    fundAccount,
    waitForNote,
    waitForTokenNotes,
    assertBalance,
  };
}

/** Surfaces actual hook errors to readers and to the browser test harness. */
export function TutorialButton({
  name,
  label,
  run,
}: {
  name: string;
  label: string;
  run: () => Promise<void>;
}) {
  const { isReady, error: initializationError } = useMiden();
  const [state, setState] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const execute = async () => {
    setState('running');
    setError(null);
    try {
      await run();
      setState('passed');
      console.log(`React tutorial passed: ${name}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setState('failed');
      console.error(message);
    }
  };
  return (
    <section
      data-testid={`react-${name}`}
      data-state={initializationError ? 'failed' : state}
    >
      <button onClick={execute} disabled={!isReady || state === 'running'}>
        {isReady ? label : 'Initializing…'}
      </button>
      <p role="status">{initializationError?.message ?? error ?? state}</p>
    </section>
  );
}
