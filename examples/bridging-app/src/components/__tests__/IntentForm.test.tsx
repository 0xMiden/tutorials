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
vi.mock('../../hooks/useIntentTransactionStatus', () => ({
  useIntentTransactionStatus: () => ({
    statuses: [],
    isPolling: false,
    error: null,
    refetch: vi.fn(),
  }),
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
