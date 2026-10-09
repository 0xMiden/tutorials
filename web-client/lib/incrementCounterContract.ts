// lib/incrementCounterContract.ts
import counterContractCode from './masm/counter_contract.masm';
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

export async function incrementCounterContract(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  const client = await createTutorialClient();
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterSlotName = 'miden::tutorials::counter';

  const counterAccountComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const walletSeed = new Uint8Array(32);
  crypto.getRandomValues(walletSeed);
  const auth = AuthSecretKey.rpoFalconWithRNG(walletSeed);

  const account = await createFundableContractAccount(
    client,
    walletSeed,
    auth,
    [counterAccountComponent],
  );

  await fundAccountForFees(client, account);

  const txScriptCode = `
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
`;

  const script = await client.compile.txScript({
    code: txScriptCode,
    libraries: [
      {
        namespace: 'external_contract::counter_contract',
        code: counterContractCode,
      },
    ],
  });

  await client.sync();
  const { txId } = await client.transactions.execute({
    account,
    script,
    waitForConfirmation: true,
    timeout: 120_000,
  });
  console.log(`Transaction committed: ${txId.toHex()}`);

  console.log('Counter contract ID:', account.id().toString());

  const counter = await client.accounts.get(account);
  // `getItem()` is typed to return a low-level `Word`, but at runtime the SDK
  // wraps the slot in a `StorageResult` whose `toBigInt()` reads the first
  // felt — the count. The cast reflects that runtime type.
  const count = counter?.storage().getItem(counterSlotName) as unknown as
    StorageResult | undefined;
  const counterValue = Number(count!.toBigInt());
  if (counterValue !== 1)
    throw new Error(`Expected counter 1, got ${counterValue}`);
  console.log('Count: ', counterValue);
}
