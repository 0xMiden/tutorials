// lib/foreignProcedureInvocation.ts
import counterContractCode from './masm/counter_contract.masm';
import countReaderCode from './masm/count_reader.masm';
import { AccountType, AuthSecretKey, StorageMode, StorageSlot, MidenClient } from '@miden-sdk/miden-sdk/lazy';

export async function foreignProcedureInvocation(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('foreignProcedureInvocation() can only run in the browser');
    return;
  }

  await MidenClient.ready();

  const nodeEndpoint = 'https://rpc.testnet.miden.io';
  const client = await MidenClient.create({ rpcUrl: nodeEndpoint });
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

  const counterAccount = await client.accounts.create({
    type: AccountType.RegularAccountImmutableCode,
    storage: StorageMode.Public,
    seed: counterSeed,
    auth: counterAuth,
    components: [counterComponent],
  });

  // Deploy the counter to the node by executing a transaction on it
  const deployScript = await client.compile.txScript({
    code: `
      use external_contract::counter_contract
      begin
        call.counter_contract::increment_count
      end
    `,
    libraries: [{ namespace: 'external_contract::counter_contract', code: counterContractCode }],
  });

  // Wait for the deploy transaction to be committed to a block
  // before using it as a foreign account in FPI
  await client.transactions.execute({
    account: counterAccount,
    script: deployScript,
    waitForConfirmation: true,
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

  let countReaderAccount = await client.accounts.create({
    type: AccountType.RegularAccountImmutableCode,
    storage: StorageMode.Public,
    seed: readerSeed,
    auth: readerAuth,
    components: [countReaderComponent],
  });

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

    begin
    padw padw padw padw
    # => [pad(16)]

    push.${getCountProcHash}
    # => [GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().prefix()}
    # => [account_id_prefix, GET_COUNT_HASH, pad(16)]

    push.${counterAccount.id().suffix()}
    # => [account_id_suffix, account_id_prefix, GET_COUNT_HASH, pad(16)]

    call.count_reader_contract::copy_count
    # => []

    exec.sys::truncate_stack
    # => []

    end
`;

  const script = await client.compile.txScript({
    code: fpiScriptCode,
    libraries: [{ namespace: 'external_contract::count_reader_contract', code: countReaderCode }],
  });

  await client.transactions.execute({
    account: countReaderAccount,
    script,
    foreignAccounts: [counterAccount],
  });

  const updatedCountReader = await client.accounts.get(countReaderAccount);
  const countReaderStorage = updatedCountReader
    ?.storage()
    .getItem(countReaderSlotName);

  if (countReaderStorage) {
    const countValue = Number(countReaderStorage.toU64s()[3]);
    console.log('Count copied via Foreign Procedure Invocation:', countValue);
  }

  console.log('\nForeign Procedure Invocation Transaction completed!');
}
