# Test Patterns

Copy-adaptable test patterns for Miden frontend components.

## Available Patterns

### `provider-setup.test.tsx`
Starting point for any component that uses Miden hooks. Shows mock setup, `vi.mocked()` overrides, and testing ready/loading/error states.

### `query-hook.test.tsx`
Pattern for components displaying data from query hooks (`useAccounts`, `useNotes`, etc.). Shows loading → data → error → empty state testing.

### `mutation-hook.test.tsx`
Pattern for components performing transactions (`useSend`, `useMint`, etc.). Shows idle → stage progression → success → error testing, plus argument verification.

## How to Use

1. Copy the closest pattern to your component's `__tests__/` directory
2. Rename the test file to match your component
3. Replace the example component with your actual component import
4. Adapt assertions to your component's specific behavior
5. Keep the `vi.mock(...)` and `beforeEach(vi.clearAllMocks)` boilerplate

## Mock Setup

All patterns use the shared mock factory:

```tsx
vi.mock("@miden-sdk/react", () => import("@/__tests__/mocks/miden-sdk-react"));
```

Override specific hooks per-test:

```tsx
vi.mocked(useAccounts).mockReturnValue({ wallets: [], ... });
```

## Fixtures

Realistic test data is in `src/__tests__/fixtures/`. Import what you need:

```tsx
import { WALLET_ID_1, MOCK_ASSET_BALANCE } from "@/__tests__/fixtures";
```
