// lib/incrementCounterContract.ts
import counterContractCode from './masm/counter_contract.masm';
import { AuthSecretKey, StorageMode, StorageSlot, StorageResult, MidenClient } from '@miden-sdk/miden-sdk/lazy';

export async function incrementCounterContract(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  await MidenClient.ready();

  const nodeEndpoint = 'https://rpc.testnet.miden.io';
  const client = await MidenClient.create({ rpcUrl: nodeEndpoint });
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterSlotName = 'miden::tutorials::counter';

  const counterAccountComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const walletSeed = new Uint8Array(32);
  crypto.getRandomValues(walletSeed);
  const auth = AuthSecretKey.rpoFalconWithRNG(walletSeed);

  const account = await client.accounts.create({
    storage: StorageMode.Public,
    seed: walletSeed,
    auth,
    components: [counterAccountComponent],
  });

  const txScriptCode = `
    use external_contract::counter_contract
    begin
    call.counter_contract::increment_count
    end
`;

  const script = await client.compile.txScript({
    code: txScriptCode,
    libraries: [{ namespace: 'external_contract::counter_contract', code: counterContractCode }],
  });

  await client.transactions.execute({
    account,
    script,
  });

  console.log('Counter contract ID:', account.id().toString());

  const counter = await client.accounts.get(account);
  // `getItem()` is typed to return a low-level `Word`, but at runtime the SDK
  // wraps the slot in a `StorageResult` whose `toBigInt()` reads the first
  // felt — the count. The cast reflects that runtime type.
  const count = counter?.storage().getItem(counterSlotName) as unknown as
    | StorageResult
    | undefined;
  const counterValue = Number(count!.toBigInt());
  console.log('Count: ', counterValue);
}
