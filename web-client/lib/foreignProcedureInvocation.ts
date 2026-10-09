// lib/foreignProcedureInvocation.ts
import counterContractCode from './masm/counter_contract.masm';
import countReaderCode from './masm/count_reader.masm';
import {
  AuthSecretKey,
  StorageSlot,
  StorageResult,
} from '@miden-sdk/miden-sdk/lazy';
import {
  createFundableContractAccount,
  createTutorialClient,
  fundAccountForFees,
} from './feeSupport';

export async function foreignProcedureInvocation(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('foreignProcedureInvocation() can only run in the browser');
    return;
  }

  const client = await createTutorialClient();
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterSlotName = 'miden::tutorials::counter';
  const countReaderSlotName = 'miden::tutorials::count_reader';

  // -------------------------------------------------------------------------
  // STEP 1: Deploy the Counter Contract
  // -------------------------------------------------------------------------
  console.log('\n[STEP 1] Deploying counter contract.');

  const counterComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const counterSeed = new Uint8Array(32);
  crypto.getRandomValues(counterSeed);
  const counterAuth = AuthSecretKey.rpoFalconWithRNG(counterSeed);

  const counterAccount = await createFundableContractAccount(
    client,
    counterSeed,
    counterAuth,
    [counterComponent],
  );

  await fundAccountForFees(client, counterAccount);

  // Deploy the counter to the node by executing a transaction on it
  const deployScript = await client.compile.txScript({
    code: `
use external_contract::counter_contract

#! Increments the counter.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    call.counter_contract::increment_count
    # => [pad(16)]
end
`,
    libraries: [
      {
        namespace: 'external_contract::counter_contract',
        code: counterContractCode,
      },
    ],
  });

  // Wait for the deploy transaction to be committed to a block
  // before using it as a foreign account in FPI
  await client.sync();
  await client.transactions.execute({
    account: counterAccount,
    script: deployScript,
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log('Counter contract ID:', counterAccount.id().toString());

  // -------------------------------------------------------------------------
  // STEP 2: Create the Count Reader Contract
  // -------------------------------------------------------------------------
  console.log('\n[STEP 2] Creating count reader contract.');

  const countReaderComponent = await client.compile.component({
    code: countReaderCode,
    slots: [StorageSlot.emptyValue(countReaderSlotName)],
  });

  const readerSeed = new Uint8Array(32);
  crypto.getRandomValues(readerSeed);
  const readerAuth = AuthSecretKey.rpoFalconWithRNG(readerSeed);

  const countReaderAccount = await createFundableContractAccount(
    client,
    readerSeed,
    readerAuth,
    [countReaderComponent],
  );

  await fundAccountForFees(client, countReaderAccount);

  console.log('Count reader contract ID:', countReaderAccount.id().toString());

  // -------------------------------------------------------------------------
  // STEP 3: Call the Counter Contract via Foreign Procedure Invocation (FPI)
  // -------------------------------------------------------------------------
  console.log(
    '\n[STEP 3] Call counter contract with FPI from count reader contract',
  );

  const getCountProcHash = counterComponent.getProcedureHash('get_count');

  const fpiScriptCode = `
use external_contract::count_reader_contract
use miden::core::sys

#! Copies a public counter through the reader account.
#!
#! Inputs:  [ARGS, pad(12)]
#! Outputs: [pad(16)]
#!
#! Where:
#! - ARGS contains unused transaction script arguments.
#!
#! Invocation: dyncall
@transaction_script
pub proc main(args: word)
    dropw
    # => [pad(16)]

    push.${getCountProcHash}
    # => [GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().prefix()}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().suffix()}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => [pad(16)]

    exec.sys::truncate_stack
    # => [pad(16)]
end
`;

  const script = await client.compile.txScript({
    code: fpiScriptCode,
    libraries: [
      {
        namespace: 'external_contract::count_reader_contract',
        code: countReaderCode,
      },
    ],
  });

  await client.sync();
  const { txId } = await client.transactions.execute({
    account: countReaderAccount,
    script,
    foreignAccounts: [counterAccount],
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log(`Transaction committed: ${txId.toHex()}`);

  const updatedCountReader = await client.accounts.get(countReaderAccount);
  // `getItem()` is typed to return a low-level `Word`, but at runtime the SDK
  // wraps the slot in a `StorageResult` whose `toBigInt()` reads the first
  // felt — the count. The cast reflects that runtime type.
  const countReaderStorage = updatedCountReader
    ?.storage()
    .getItem(countReaderSlotName) as unknown as StorageResult | undefined;

  if (countReaderStorage) {
    const countValue = Number(countReaderStorage.toBigInt());
    if (countValue !== 1)
      throw new Error(`Expected copied counter 1, got ${countValue}`);
    console.log('Count copied via Foreign Procedure Invocation:', countValue);
  } else {
    throw new Error('Count reader storage was not available after commitment');
  }

  console.log('\nForeign Procedure Invocation Transaction completed!');
}
