/**
 * Consumer-level tests for IntentForm balance rendering.
 *
 * These tests pin the per-component behaviour the helper-level
 * `formatMidenAssetAmount` tests cannot reach: the Source-asset dropdown
 * option and the selected `Balance:` label must display formatted token
 * amounts (e.g. `100` for `100_000_000n` base units on a 6-decimal faucet),
 * never the raw bigint. Reference: `TASK-final-revision-post-human-check-8.9.md`
 * lines 188-195, "Add focused balance-format tests".
 *
 * Mocks the wagmi + wallet-adapter surfaces because IntentForm pulls
 * `useAccount` (wagmi), `useMidenFiWallet` (Miden wallet adapter), and
 * `useSyncState` (`@miden-sdk/react`) at the top of the file — none of those
 * are exercised by these tests, but they must resolve to avoid runtime errors
 * when IntentForm renders.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@miden-sdk/react', () => import('@/__tests__/mocks/miden-sdk-react'));
// `epoch-bridge.ts` imports `AccountId, Address` from `@miden-sdk/miden-sdk`
// at module top — that package eager-loads its WASM, which fails under jsdom
// with "fetch failed: not implemented... yet". Stubbing the two named imports
// is enough; nothing IntentForm renders calls into them.
vi.mock('@miden-sdk/miden-sdk', () => ({
  AccountId: { fromHex: vi.fn(() => ({ toString: () => '0x0' })) },
  Address: { fromBech32: vi.fn(() => ({ accountId: () => ({ toString: () => '0x0' }) })) },
}));
vi.mock('@miden-sdk/miden-wallet-adapter-react', () => ({
  useMidenFiWallet: () => ({
    connected: false,
    address: null,
    requestSend: vi.fn(),
    waitForTransaction: vi.fn(),
  }),
}));
vi.mock('@miden-sdk/miden-wallet-adapter-base', () => ({
  // IntentForm constructs a `SendTransaction` only in the Confirm-&-sign flow,
  // which these tests do not exercise. A minimal class stub keeps imports
  // resolvable without dragging in the real WASM-backed SDK.
  SendTransaction: class {
    constructor(public sender: string, public recipient: string, public faucet: string, public note: string, public amount: number) {}
  },
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
}));
// Configurable `useIntentTransactionStatus` mock. `vi.hoisted` lets the hoisted
// `vi.mock` factory reference this ref; individual tests set `current` to drive
// the status rows IntentForm reduces.
const txStatusMock = vi.hoisted(() => ({
  current: {
    statuses: [] as Array<{ chainId: number; status: string; transactionHash: string }>,
    isPolling: false as boolean,
    error: null as string | null,
    refetch: () => {},
  },
}));
vi.mock('../../hooks/useIntentTransactionStatus', () => ({
  useIntentTransactionStatus: () => txStatusMock.current,
}));

import { IntentForm } from '../crosschain/IntentForm';

// Radix UI Select uses pointer-capture + scrollIntoView in its internals;
// jsdom does not implement either. Stubbing these makes the trigger clickable
// in the test environment without changing component behaviour.
beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  }
  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

// Reset the status mock to "no rows" before every test so cases stay isolated.
beforeEach(() => {
  txStatusMock.current = {
    statuses: [],
    isPolling: false,
    error: null,
    refetch: () => {},
  };
});

const baseProps = {
  midenAccountId: '0xd1a18268a9d811106384f6c2673f2a',
  isLoadingMidenAssets: false,
  onFetchQuote: vi.fn(async () => undefined),
  onConfirmIntent: vi.fn(async () => undefined),
  onClearQuote: vi.fn(),
  pendingQuote: null,
  isFetchingQuote: false,
  isConfirmBusy: false,
  isSDKReady: true,
};

const USDC_FAUCET = '0x0a7d175ed63ec5200fb2ced86f6aa5';

describe('IntentForm balance rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Source-asset dropdown option as a formatted token amount, not a raw bigint', async () => {
    const user = userEvent.setup();
    render(
      <IntentForm
        {...baseProps}
        midenAssets={[
          {
            assetId: USDC_FAUCET,
            amount: 100_000_000n,
            symbol: 'USDC',
            decimals: 6,
          },
        ]}
      />,
    );

    // Open the Source-asset combobox.
    const trigger = screen.getByRole('combobox', { name: /select miden asset/i });
    await user.click(trigger);

    // Radix portals options to document.body; query the whole document so we
    // catch listbox items regardless of portal target.
    const option = await screen.findByRole('option');
    expect(option.textContent).toContain('USDC — 100');
    expect(option.textContent).not.toContain('100000000');
  });

  it('renders the selected Balance: label as the formatted amount, not the raw bigint', async () => {
    const user = userEvent.setup();
    render(
      <IntentForm
        {...baseProps}
        midenAssets={[
          {
            assetId: USDC_FAUCET,
            amount: 100_000_000n,
            symbol: 'USDC',
            decimals: 6,
          },
        ]}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: /select miden asset/i });
    await user.click(trigger);

    const option = await screen.findByRole('option');
    await user.click(option);

    // The Balance line lives in a paragraph immediately below the combobox; it
    // contains an interior <span class="font-mono"> with the formatted number.
    const balanceLine = await screen.findByText((_, el) => {
      return !!el && el.tagName.toLowerCase() === 'p' && /balance:/i.test(el.textContent ?? '');
    });
    const balanceValue = within(balanceLine).getByText('100');
    expect(balanceValue.textContent).toBe('100');
    expect(balanceLine.textContent).not.toMatch(/100000000/);
  });
});

describe('IntentForm destination-chain-aware settlement (PR #199)', () => {
  // An internal/non-destination success row (Base Sepolia 84532) plus the
  // user's destination-chain row (Sepolia 11155111, the form default). The
  // destination row must drive the EVM-execution panel — the Compact row must
  // never leak as the settlement.
  const COMPACT_HASH = '0xcompact000000000000000000000000000000000000000000000000000000a1';
  const DEST_PENDING_HASH = '0xdestpending000000000000000000000000000000000000000000000000000b2';
  const DEST_SUCCESS_HASH = '0xdestsuccess000000000000000000000000000000000000000000000000000c3';

  it('does not surface a non-destination success while the destination row is pending', () => {
    txStatusMock.current = {
      statuses: [
        { chainId: 84532, status: 'success', transactionHash: COMPACT_HASH },
        { chainId: 11155111, status: 'pending', transactionHash: DEST_PENDING_HASH },
      ],
      isPolling: true,
      error: null,
      refetch: () => {},
    };

    render(<IntentForm {...baseProps} midenAssets={[]} />);

    // Destination row (Sepolia) is still pending → no settlement panel, no hash.
    expect(screen.queryByText(/EVM execution tx hash/i)).toBeNull();
    expect(screen.queryByText(COMPACT_HASH)).toBeNull();
    expect(screen.queryByText(DEST_PENDING_HASH)).toBeNull();
    // Still polling with no settled destination row → waiting state shown.
    expect(screen.getByText(/Waiting for EVM execution/i)).toBeInTheDocument();
  });

  it('keeps waiting when a destination success coexists with an in-flight pending row', () => {
    // Brian's exact case: a destination-chain success alongside an in-flight
    // destination-chain tx. The pending row must block settlement so the success
    // hash is not shown as final — proves the pending gate at the UI level.
    txStatusMock.current = {
      statuses: [
        { chainId: 11155111, status: 'success', transactionHash: DEST_SUCCESS_HASH },
        { chainId: 11155111, status: 'pending', transactionHash: DEST_PENDING_HASH },
      ],
      isPolling: true,
      error: null,
      refetch: () => {},
    };

    render(<IntentForm {...baseProps} midenAssets={[]} />);

    expect(screen.queryByText(/EVM execution tx hash/i)).toBeNull();
    expect(screen.queryByText(DEST_SUCCESS_HASH)).toBeNull();
    expect(screen.getByText(/Waiting for EVM execution/i)).toBeInTheDocument();
  });

  it('surfaces the destination-chain success once no destination row is pending', () => {
    txStatusMock.current = {
      statuses: [
        { chainId: 84532, status: 'success', transactionHash: COMPACT_HASH },
        { chainId: 11155111, status: 'success', transactionHash: DEST_SUCCESS_HASH },
      ],
      isPolling: false,
      error: null,
      refetch: () => {},
    };

    render(<IntentForm {...baseProps} midenAssets={[]} />);

    expect(screen.getByText(/EVM execution tx hash/i)).toBeInTheDocument();
    expect(screen.getByText(DEST_SUCCESS_HASH)).toBeInTheDocument();
    // The internal/non-destination success row is never shown as settlement.
    expect(screen.queryByText(COMPACT_HASH)).toBeNull();
  });
});
