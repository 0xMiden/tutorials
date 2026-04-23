// lib/incrementCounterContract.ts
import counterContractCode from './masm/counter_contract.masm';
import { AccountType, AuthSecretKey, StorageMode, StorageSlot, MidenClient } from '@miden-sdk/miden-sdk/lazy';

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
    type: AccountType.RegularAccountImmutableCode,
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
  const count = counter?.storage().getItem(counterSlotName);
  // The counter contract stores its count as a Felt widened to Word
  // [count, 0, 0, 0]; `toU64s()` preserves native order so the value
  // lives at index 0.
  const counterValue = Number(count!.toU64s()[0]);
  console.log('Count: ', counterValue);
}
