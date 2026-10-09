import {
  Account,
  AccountBuilder,
  AccountComponent,
  AccountId,
  AccountStorageMode,
  AuthSecretKey,
  Endpoint,
  MidenClient,
  RpcClient,
  type ClientOptions,
  type InputNoteRecord,
} from '@miden-sdk/miden-sdk/lazy';

type TutorialNetwork = 'testnet' | 'devnet';
type ExecutingAccount = Account | AccountId;

type FaucetPowResponse = {
  challenge: string;
  target: string | number;
};

type FaucetMintResponse = {
  note_id: string;
};

type FaucetMetadata = {
  base_amount: number;
  id: string;
};

const DEFAULT_DEVNET_FAUCET_URL = 'https://faucet-api.devnet.miden.io';
const DEFAULT_TESTNET_FAUCET_URL = 'https://faucet-api.testnet.miden.io';
// Network notes settle asynchronously; keep a bounded two-minute polling window.
const FUNDING_NOTE_POLL_ATTEMPTS = 24;
const FUNDING_NOTE_POLL_INTERVAL_MS = 5_000;

export function tutorialNetwork(): TutorialNetwork {
  const configured = process.env.NEXT_PUBLIC_MIDEN_NETWORK?.toLowerCase();

  if (!configured || configured === 'testnet') return 'testnet';
  if (configured === 'devnet') return 'devnet';

  throw new Error(
    `Unsupported NEXT_PUBLIC_MIDEN_NETWORK=${configured}; expected testnet or devnet`,
  );
}

export function tutorialExplorerUrl(): string {
  return tutorialNetwork() === 'devnet'
    ? 'https://devnet.midenscan.com'
    : 'https://testnet.midenscan.com';
}

export async function createTutorialClient(
  options: ClientOptions = {},
): Promise<MidenClient> {
  await MidenClient.ready();
  return tutorialNetwork() === 'devnet'
    ? MidenClient.createDevnet(options)
    : MidenClient.createTestnet(options);
}

/**
 * The high-level contract helper installs auth plus the custom component. A
 * fee-enabled contract also needs BasicWallet so its bootstrap P2ID note can
 * deposit the native fee asset into the vault.
 */
export async function createFundableContractAccount(
  client: MidenClient,
  seed: Uint8Array,
  auth: AuthSecretKey,
  components: AccountComponent[],
): Promise<Account> {
  let builder = new AccountBuilder(seed)
    .storageMode(AccountStorageMode.public())
    .withAuthComponent(AccountComponent.createAuthComponentFromSecretKey(auth))
    .withBasicWalletComponent();

  for (const component of components) {
    builder = builder.withComponent(component);
  }

  const account = builder.build().account;
  await client.accounts.insert({ account });
  await client.keystore.insert(account.id(), auth);
  return account;
}

function accountId(account: ExecutingAccount): AccountId {
  return account instanceof Account ? account.id() : account;
}

/** Read the native fee asset and activation from the selected chain. */
export async function tutorialFeeConfig(client: {
  feeFaucetId(): Promise<AccountId>;
}) {
  const endpoint =
    tutorialNetwork() === 'devnet' ? Endpoint.devnet() : Endpoint.testnet();
  const header = await new RpcClient(endpoint).getBlockHeaderByNumber();
  return {
    faucetId: await client.feeFaucetId(),
    baseFee: header.verificationBaseFee(),
  };
}

export async function consumeAllFeeAware(
  client: MidenClient,
  account: ExecutingAccount,
) {
  await client.sync();
  const available = await client.notes.listAvailable({
    account: accountId(account),
  });
  // TX_FEE notes (tag 0xFEE) are consumable by any account; they are not P2ID transfers.
  const notes = available.filter(
    (note) => note.metadata()?.tag().asU32() !== 0xfee,
  );
  if (notes.length === 0) {
    throw new Error(`No consumable notes found for ${accountId(account)}`);
  }
  return client.transactions.consume({
    account,
    notes,
    waitForConfirmation: true,
    timeout: 120_000,
  });
}

function faucetUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MIDEN_FAUCET_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  return tutorialNetwork() === 'devnet'
    ? DEFAULT_DEVNET_FAUCET_URL
    : DEFAULT_TESTNET_FAUCET_URL;
}

function hexBytes(value: string): Uint8Array {
  const hex = value.replace(/^0x/, '');
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('The faucet returned an invalid PoW challenge');
  }

  return Uint8Array.from(hex.match(/.{2}/g)!, (byte) =>
    Number.parseInt(byte, 16),
  );
}

async function solvePow(challenge: string, target: bigint): Promise<bigint> {
  const challengeBytes = hexBytes(challenge);
  const nonceBytes = new Uint8Array(8);
  const nonceView = new DataView(nonceBytes.buffer);
  const input = new Uint8Array(challengeBytes.length + nonceBytes.length);
  input.set(challengeBytes);

  for (let attempt = 0; ; attempt += 1) {
    const high = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const low = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const nonce = (high << BigInt(32)) | low;
    nonceView.setBigUint64(0, nonce, false);
    input.set(nonceBytes, challengeBytes.length);

    const hash = await crypto.subtle.digest('SHA-256', input);
    const digest = new DataView(hash).getBigUint64(0, false);
    if (digest < target) return nonce;

    if (attempt % 1_000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function fetchJson<T>(url: URL | string, operation: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${operation} failed (${response.status}): ${body.trim()}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function requestFundingNote(
  recipient: AccountId,
  requestedAmount?: number,
): Promise<FaucetMintResponse> {
  const baseUrl = faucetUrl();
  const metadata = await fetchJson<FaucetMetadata>(
    `${baseUrl}/get_metadata`,
    'Reading faucet metadata',
  );
  // In v0.17 metadata.id names the funding wallet, not the native asset issuer.
  const expectedPrefix = tutorialNetwork() === 'devnet' ? 'mdev1' : 'mtst1';
  if (!metadata.id.startsWith(expectedPrefix)) {
    throw new Error(`Configured faucet does not serve ${tutorialNetwork()}`);
  }

  const configuredAmount = process.env.NEXT_PUBLIC_MIDEN_FEE_AMOUNT?.trim();
  const amount =
    requestedAmount ??
    (configuredAmount ? Number(configuredAmount) : metadata.base_amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      `Invalid fee-funding amount ${String(amount)}; expected a positive safe integer`,
    );
  }

  const powUrl = new URL(`${baseUrl}/pow`);
  powUrl.searchParams.set('account_id', recipient.toString());
  powUrl.searchParams.set('amount', amount.toString());
  const pow = await fetchJson<FaucetPowResponse>(
    powUrl,
    'Requesting faucet PoW',
  );
  const nonce = await solvePow(pow.challenge, BigInt(pow.target));

  const mintUrl = new URL(`${baseUrl}/get_tokens`);
  mintUrl.searchParams.set('account_id', recipient.toString());
  mintUrl.searchParams.set('is_private_note', 'false');
  mintUrl.searchParams.set('asset_amount', amount.toString());
  mintUrl.searchParams.set('challenge', pow.challenge);
  mintUrl.searchParams.set('nonce', nonce.toString());
  return fetchJson<FaucetMintResponse>(mintUrl, 'Requesting fee tokens');
}

async function waitForFundingNote(
  client: MidenClient,
  noteId: string,
): Promise<InputNoteRecord> {
  for (let attempt = 0; attempt < FUNDING_NOTE_POLL_ATTEMPTS; attempt += 1) {
    await client.sync();
    const note = await client.notes.get(noteId);
    if (note?.inclusionProof()) return note;
    if (attempt < FUNDING_NOTE_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, FUNDING_NOTE_POLL_INTERVAL_MS),
      );
    }
  }

  throw new Error(
    `Fee-funding note ${noteId} was not found after ${FUNDING_NOTE_POLL_ATTEMPTS} sync attempts`,
  );
}

/**
 * Funds a newly-created account with the chain's native fee asset. The first
 * consume transaction can pay from the asset added by the input P2ID note, so
 * this also bootstraps accounts whose vault starts empty.
 */
export async function fundAccountForFees(
  client: MidenClient,
  account: ExecutingAccount,
  amount?: number,
): Promise<void> {
  await client.sync();
  const { faucetId: feeFaucet, baseFee } = await tutorialFeeConfig(client);
  if (baseFee === 0) return;

  const id = accountId(account);
  // Read the native fee balance from the synchronized account vault.
  const updated = await client.accounts.get(id);
  if (!updated) throw new Error(`Account ${id} is not in the local store`);
  const balance = updated.vault().getBalance(feeFaucet);
  if (balance > BigInt(0)) return;

  console.log(`Funding ${id} with ${tutorialNetwork()} fee tokens…`);
  const mint = await requestFundingNote(id, amount);
  console.log(`Funding request accepted; waiting for note ${mint.note_id}…`);
  const note = await waitForFundingNote(client, mint.note_id);
  assertNativeFundingNote(note, feeFaucet);
  await client.sync();
  const { txId } = await client.transactions.consume({
    account,
    notes: [note],
    waitForConfirmation: true,
    timeout: 120_000,
  });
  await client.sync();
  console.log(`Fee funding submitted: ${txId.toHex()}`);
}

/** Verify the actual on-chain asset before consuming a funding-service note. */
export function assertNativeFundingNote(
  note: InputNoteRecord,
  faucetId: AccountId,
): void {
  const hasNativeAsset = note
    .details()
    .assets()
    .fungibleAssets()
    .some((asset) => asset.faucetId().toString() === faucetId.toString());
  if (!hasNativeAsset) {
    throw new Error(
      `Funding note does not contain the native fee asset ${faucetId}`,
    );
  }
}
