// lib/foreignProcedureInvocation.ts
export async function foreignProcedureInvocation(): Promise<void> {
  if (typeof window === 'undefined') {
    console.warn('foreignProcedureInvocation() can only run in the browser');
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

  const countReaderCode = `
    use miden::protocol::active_account
    use miden::protocol::native_account
    use miden::protocol::tx
    use miden::core::word
    use miden::core::sys

    const COUNT_READER_SLOT = word("miden::tutorials::count_reader")

    # => [account_id_prefix, account_id_suffix, get_count_proc_hash]
    pub proc copy_count
        exec.tx::execute_foreign_procedure
        # => [count]

        push.COUNT_READER_SLOT[0..2]
        # [slot_id_prefix, slot_id_suffix, count]

        exec.native_account::set_item
        # => [OLD_VALUE]

        dropw
        # => []

        exec.sys::truncate_stack
        # => []
    end
`;

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
    type: AccountType.ImmutableContract,
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
  await client.sync();
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

  const countReaderAccount = await client.accounts.create({
    type: AccountType.ImmutableContract,
    storage: StorageMode.Public,
    seed: readerSeed,
    auth: readerAuth,
    components: [countReaderComponent],
  });

  await client.sync();
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
    push.${getCountProcHash}
    # => [GET_COUNT_HASH]

    push.${counterAccount.id().suffix()}
    # => [account_id_suffix, GET_COUNT_HASH]

    push.${counterAccount.id().prefix()}
    # => [account_id_prefix, account_id_suffix, GET_COUNT_HASH]

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

  await client.sync();

  const updatedCountReaderContract = await client.accounts.get(
    countReaderAccount,
  );
  const countReaderStorage = updatedCountReaderContract
    ?.storage()
    .getItem(countReaderSlotName);

  if (countReaderStorage) {
    const countValue = Number(
      BigInt(
        '0x' +
          countReaderStorage
            .toHex()
            .slice(-16)
            .match(/../g)!
            .reverse()
            .join(''),
      ),
    );
    console.log('Count copied via Foreign Procedure Invocation:', countValue);
  }

  console.log('\nForeign Procedure Invocation Transaction completed!');
}
