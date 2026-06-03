/**
 * TEST PATTERN: Query Hook Component
 *
 * Shows how to test a component that displays data from Miden query hooks.
 * Covers the three essential states: loading, success (with data), and error.
 *
 * Key concepts:
 * - Override hook return values per-test with vi.mocked()
 * - Test loading skeleton/placeholder states
 * - Test data rendering with realistic fixtures
 * - Test error display and recovery (refetch)
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@miden-sdk/react", () => import("@/__tests__/mocks/miden-sdk-react"));

import { useAccounts, useSyncState } from "@miden-sdk/react";
import {
  MOCK_WALLET_HEADER,
  MOCK_WALLET_HEADER_2,
  MOCK_FAUCET_HEADER,
} from "@/__tests__/fixtures";

// Example component that lists accounts — a common Miden UI pattern
function AccountList() {
  const { wallets, faucets, isLoading, error, refetch } = useAccounts();
  const { syncHeight } = useSyncState();

  if (error) {
    return (
      <div>
        <p role="alert">Failed to load accounts: {error.message}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (isLoading) {
    return <p>Loading accounts...</p>;
  }

  return (
    <div>
      <p>Synced to block {syncHeight}</p>
      <h2>Wallets ({wallets.length})</h2>
      <ul aria-label="wallets">
        {wallets.map((w) => (
          <li key={String(w.id)}>{String(w.id)}</li>
        ))}
      </ul>
      <h2>Faucets ({faucets.length})</h2>
      <ul aria-label="faucets">
        {faucets.map((f) => (
          <li key={String(f.id)}>{String(f.id)}</li>
        ))}
      </ul>
    </div>
  );
}

describe("Query Hook Pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Default mocks return realistic data — component should render account lists
  it("renders account lists with data", () => {
    render(<AccountList />);

    // Wallet list should contain both mock wallets
    const walletList = screen.getByRole("list", { name: "wallets" });
    expect(walletList.children).toHaveLength(2);
    expect(screen.getByText(MOCK_WALLET_HEADER.id)).toBeInTheDocument();
    expect(screen.getByText(MOCK_WALLET_HEADER_2.id)).toBeInTheDocument();

    // Faucet list should contain the mock faucet
    const faucetList = screen.getByRole("list", { name: "faucets" });
    expect(faucetList.children).toHaveLength(1);
    expect(screen.getByText(MOCK_FAUCET_HEADER.id)).toBeInTheDocument();

    // Sync height from useSyncState mock
    expect(screen.getByText(/Synced to block 12345/)).toBeInTheDocument();
  });

  // Override to loading state — component should show loading indicator
  it("shows loading state while fetching accounts", () => {
    vi.mocked(useAccounts).mockReturnValue({
      accounts: [],
      wallets: [],
      faucets: [],
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<AccountList />);
    expect(screen.getByText("Loading accounts...")).toBeInTheDocument();
    // Account lists should NOT be rendered during loading
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // Override to error state — component should show error with retry button
  it("shows error with retry button on failure", async () => {
    const mockRefetch = vi.fn();
    vi.mocked(useAccounts).mockReturnValue({
      accounts: [],
      wallets: [],
      faucets: [],
      isLoading: false,
      error: new Error("Network timeout"),
      refetch: mockRefetch,
    });

    render(<AccountList />);

    // Error message should be visible and accessible
    expect(screen.getByRole("alert")).toHaveTextContent("Network timeout");

    // Clicking retry should call refetch
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  // Test empty state — no accounts yet (fresh install)
  it("renders empty lists when no accounts exist", () => {
    vi.mocked(useAccounts).mockReturnValue({
      accounts: [],
      wallets: [],
      faucets: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<AccountList />);
    expect(screen.getByText("Wallets (0)")).toBeInTheDocument();
    expect(screen.getByText("Faucets (0)")).toBeInTheDocument();
  });
});
