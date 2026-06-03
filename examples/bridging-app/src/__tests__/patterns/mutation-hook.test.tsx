/**
 * TEST PATTERN: Mutation Hook Component
 *
 * Shows how to test a component that performs Miden transactions via mutation hooks.
 * Covers: idle state, transaction stages (executing/proving/submitting), success, and error.
 *
 * Key concepts:
 * - Mock mutation functions to resolve or reject
 * - Test transaction stage display during multi-step operations
 * - Test button disable during loading to prevent double-submit
 * - Test error display and reset
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@miden-sdk/react", () => import("@/__tests__/mocks/miden-sdk-react"));

import { useSend } from "@miden-sdk/react";
import { WALLET_ID_1, WALLET_ID_2, FAUCET_ID } from "@/__tests__/fixtures";

// Example component: a send token form — common Miden UI pattern
function SendTokenForm() {
  const { send, isLoading, stage, error, reset } = useSend();

  const handleSend = async () => {
    try {
      await send({
        from: WALLET_ID_1,
        to: WALLET_ID_2,
        assetId: FAUCET_ID,
        amount: 100000000n, // 1.0 token
      });
    } catch {
      // Error is captured in the hook's error state
    }
  };

  return (
    <div>
      <button onClick={handleSend} disabled={isLoading}>
        {isLoading ? `${stage}...` : "Send 1.0 TEST"}
      </button>
      {stage === "complete" && <p>Transaction submitted!</p>}
      {error && (
        <div>
          <p role="alert">Send failed: {error.message}</p>
          <button onClick={reset}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

describe("Mutation Hook Pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Default idle state — send button should be enabled
  it("renders idle state with enabled send button", () => {
    render(<SendTokenForm />);
    const button = screen.getByRole("button", { name: "Send 1.0 TEST" });
    expect(button).toBeEnabled();
  });

  // Simulate transaction in progress — button disabled, stage shown
  it("shows transaction stage and disables button during send", () => {
    vi.mocked(useSend).mockReturnValue({
      send: vi.fn(),
      result: null,
      isLoading: true,
      stage: "proving" as const,
      error: null,
      reset: vi.fn(),
    });

    render(<SendTokenForm />);
    const button = screen.getByRole("button", { name: "proving..." });
    expect(button).toBeDisabled();
  });

  // Simulate completed transaction — success message shown
  it("shows success message after transaction completes", () => {
    vi.mocked(useSend).mockReturnValue({
      send: vi.fn(),
      result: { txId: "0xabc123", note: null },
      isLoading: false,
      stage: "complete" as const,
      error: null,
      reset: vi.fn(),
    });

    render(<SendTokenForm />);
    expect(screen.getByText("Transaction submitted!")).toBeInTheDocument();
  });

  // Simulate error — error message shown with dismiss button
  it("shows error with dismiss button on failure", async () => {
    const mockReset = vi.fn();
    vi.mocked(useSend).mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error("Insufficient balance")),
      result: null,
      isLoading: false,
      stage: "idle" as const,
      error: new Error("Insufficient balance"),
      reset: mockReset,
    });

    render(<SendTokenForm />);

    // Error should be visible
    expect(screen.getByRole("alert")).toHaveTextContent("Insufficient balance");

    // Dismiss should call reset
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockReset).toHaveBeenCalledOnce();
  });

  // Test the actual send call — verify correct arguments
  it("calls send with correct arguments on click", async () => {
    const mockSend = vi.fn(async () => ({ txId: "0xtx", note: null }));
    vi.mocked(useSend).mockReturnValue({
      send: mockSend,
      result: null,
      isLoading: false,
      stage: "idle" as const,
      error: null,
      reset: vi.fn(),
    });

    render(<SendTokenForm />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send 1.0 TEST" }));

    expect(mockSend).toHaveBeenCalledWith({
      from: WALLET_ID_1,
      to: WALLET_ID_2,
      assetId: FAUCET_ID,
      amount: 100000000n,
    });
  });
});
