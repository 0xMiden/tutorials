/**
 * TEST PATTERN: Provider Setup
 *
 * Shows how to set up the test environment for components that use Miden hooks.
 * Copy this pattern as a starting point for any Miden component test.
 *
 * Key concepts:
 * - Mock @miden-sdk/react at the module level (hoisted by vitest)
 * - Override specific hooks per-test with vi.mocked()
 * - Test ready/loading/error states that every Miden component needs
 */

import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the entire @miden-sdk/react module with realistic defaults
vi.mock("@miden-sdk/react", () => import("@/__tests__/mocks/miden-sdk-react"));

import { useMiden } from "@miden-sdk/react";

// A minimal component that uses Miden context
function StatusIndicator() {
  const { isReady, isInitializing, error } = useMiden();

  if (error) return <div role="alert">Error: {error.message}</div>;
  if (isInitializing) return <div>Initializing WASM...</div>;
  if (!isReady) return <div>Not ready</div>;
  return <div>Miden Ready</div>;
}

describe("Provider Setup Pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Default mock returns isReady: true — component should render success state
  it("renders ready state with default mocks", () => {
    render(<StatusIndicator />);
    expect(screen.getByText("Miden Ready")).toBeInTheDocument();
  });

  // Override useMiden to simulate loading — tests the initializing state
  it("renders loading state when WASM is initializing", () => {
    vi.mocked(useMiden).mockReturnValue({
      client: null,
      isReady: false,
      isInitializing: true,
      error: null,
      sync: vi.fn(),
      runExclusive: vi.fn(),
      prover: null,
      signerAccountId: null,
      signerConnected: null,
    });

    render(<StatusIndicator />);
    expect(screen.getByText("Initializing WASM...")).toBeInTheDocument();
  });

  // Override useMiden to simulate error — tests error handling
  it("renders error state when initialization fails", () => {
    vi.mocked(useMiden).mockReturnValue({
      client: null,
      isReady: false,
      isInitializing: false,
      error: new Error("WASM load failed"),
      sync: vi.fn(),
      runExclusive: vi.fn(),
      prover: null,
      signerAccountId: null,
      signerConnected: null,
    });

    render(<StatusIndicator />);
    expect(screen.getByRole("alert")).toHaveTextContent("WASM load failed");
  });
});
