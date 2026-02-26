// lib/incrementCounterContract.ts
export async function incrementCounterContract(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('webClient() can only run in the browser');
    return;
  }

  const { AccountType, AuthSecretKey, StorageMode, StorageSlot, MidenClient } =
    await import('@miden-sdk/miden-sdk');

  const nodeEndpoint = 'http://localhost:57291';
  const client = await MidenClient.create({ rpcUrl: nodeEndpoint });
  console.log('Current block number: ', (await client.sync()).blockNum());

  const counterContractCode = `
    use miden::protocol::active_account
    use miden::protocol::native_account
    use miden::core::word
    use miden::core::sys

    const COUNTER_SLOT = word("miden::tutorials::counter")

    #! Inputs:  []
    #! Outputs: [count]
    pub proc get_count
        push.COUNTER_SLOT[0..2] exec.active_account::get_item
        # => [count]

        exec.sys::truncate_stack
        # => [count]
    end

    #! Inputs:  []
    #! Outputs: []
    pub proc increment_count
        push.COUNTER_SLOT[0..2] exec.active_account::get_item
        # => [count]

        add.1
        # => [count+1]

        push.COUNTER_SLOT[0..2] exec.native_account::set_item
        # => []

        exec.sys::truncate_stack
        # => []
    end
`;

  const counterSlotName = 'miden::tutorials::counter';

  const counterAccountComponent = await client.compile.component({
    code: counterContractCode,
    slots: [StorageSlot.emptyValue(counterSlotName)],
  });

  const walletSeed = new Uint8Array(32);
  crypto.getRandomValues(walletSeed);
  const auth = AuthSecretKey.rpoFalconWithRNG(walletSeed);

  const account = await client.accounts.create({
    type: AccountType.ImmutableContract,
    storage: StorageMode.Public,
    seed: walletSeed,
    auth,
    components: [counterAccountComponent],
  });

  await client.sync();

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

  await client.sync();

  console.log('Counter contract ID:', account.id().toString());

  const counter = await client.accounts.get(account);
  const count = counter?.storage().getItem(counterSlotName);
  const counterValue = Number(
    BigInt('0x' + count!.toHex().slice(-16).match(/../g)!.reverse().join('')),
  );
  console.log('Count: ', counterValue);
}
