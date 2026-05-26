import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.playwright-mcp/extensions/**` is generated browser-extension state from
  // the local Playwright MCP harness — see the bridging-app README's
  // "Playwright MCP wallet extensions" section. Those files are unpacked
  // third-party wallet builds (MetaMask, MidenFi) and are not part of this
  // project's source code, so they must not be linted.
  globalIgnores(['dist', '.playwright-mcp/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The Epoch SDK + viem/wagmi + Miden web SDK each expose loosely-typed
      // surfaces (notably `walletClient`, intent task data, and IntentResult
      // shapes) where the application code routinely casts to `any` for
      // interop. The tutorial-app code is small and deliberately readable;
      // fully replacing every interop `any` with a precise type would be a
      // dependent-types refactor against three external packages. Allowed
      // here; auditor reference: AUDIT-final-implementation.md → MEDIUM lint
      // finding.
      '@typescript-eslint/no-explicit-any': 'off',
      // The reference app co-locates small utility exports (`fallbackMidenNoteId`,
      // a `buttonVariants` helper, the `MidenWalletAdapterProvider` + its
      // consumer hook) with their related React components. This is a common
      // pattern in shadcn/ui-derived UI kits and in shared-context modules;
      // splitting one helper into its own file per consumer would obscure
      // the tutorial's structure for little real HMR benefit.
      'react-refresh/only-export-components': 'off',
    },
  },
])
