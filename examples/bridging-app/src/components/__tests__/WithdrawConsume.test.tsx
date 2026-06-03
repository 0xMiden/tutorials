/**
 * Tests for WithdrawConsume — the post-withdraw informational panel that tells
 * the user the Epoch allocator delivered a P2ID note to their Miden wallet
 * (which auto-consumes it). Verifies:
 *
 * 1. Renders nothing when there's no note id (pre-withdraw state).
 * 2. Renders the informational panel when a note id is supplied, with the
 *    note id truncated and a Midenscan link.
 * 3. Renders the same panel even without a wallet account id — the panel is
 *    informational only; there is no in-app consume action that depends on
 *    the wallet account.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { WithdrawConsume } from '../crosschain/WithdrawConsume';
import { MOCK_NOTE_SUMMARY, WALLET_ID_1 } from '@/__tests__/fixtures';

const NOTE_ID = MOCK_NOTE_SUMMARY.id;

describe('WithdrawConsume', () => {
  it('renders nothing before a withdraw note id is available', () => {
    const { container } = render(<WithdrawConsume midenAccountId={WALLET_ID_1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the post-withdraw informational panel when a note id is supplied', () => {
    render(<WithdrawConsume noteId={NOTE_ID} midenAccountId={WALLET_ID_1} />);
    expect(
      screen.getByRole('heading', { name: /Note delivered to your Miden wallet/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Miden Wallet auto-consumes incoming notes/i)).toBeInTheDocument();
    // Truncated note id (head of the hex string) is rendered.
    expect(screen.getByText(/0xnote1234/i)).toBeInTheDocument();
    // Midenscan link points at the right path.
    const link = screen.getByRole('link', { name: /View on Midenscan/i });
    expect(link).toHaveAttribute('href', `https://testnet.midenscan.com/note/${NOTE_ID}`);
  });

  it('still renders the informational panel when no midenAccountId is supplied', () => {
    render(<WithdrawConsume noteId={NOTE_ID} />);
    expect(
      screen.getByRole('heading', { name: /Note delivered to your Miden wallet/i }),
    ).toBeInTheDocument();
  });
});
