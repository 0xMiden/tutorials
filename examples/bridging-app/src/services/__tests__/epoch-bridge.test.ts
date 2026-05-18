/**
 * Unit coverage for the pure builder functions in `epoch-bridge.ts`.
 *
 * These exercise the task-data envelope construction without a wallet, a
 * network, or the Epoch SDK — in particular the `midenReclaimHeight` guard
 * (the bug-fix divergence from the upstream Epoch reference, which defaulted
 * the value to a literal `'1000'`).
 *
 * `@miden-sdk/miden-sdk` is mocked because `normalizeMidenIdToHex` imports
 * `AccountId`/`Address` from it; the WASM module is not needed to verify the
 * envelope shape.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@miden-sdk/miden-sdk', () => ({
  AccountId: {
    fromHex: (h: string) => ({ toString: () => h }),
    fromBech32: (b: string) => ({ toString: () => b }),
  },
  Address: {
    fromBech32: (b: string) => ({ accountId: () => ({ toString: () => b }) }),
  },
}));

import {
  formatQuoteTokenIn,
  buildEpochTaskDataParams,
  buildEVMToMidenTaskDataParams,
} from '../epoch-bridge';
import type { CrossChainIntentParams, EVMToMidenIntentParams } from '../../types/miden';
import { MIDEN_DESTINATION_CHAIN_ID } from '../../constants/chains';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

let logSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  // The builders log verbosely; keep `yarn test` output readable.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
  logSpy.mockRestore();
});

function midenToEvmParams(
  overrides: Partial<CrossChainIntentParams> = {},
): CrossChainIntentParams {
  return {
    midenAccountId: '0xaaaaaaaaaaaaaaaa',
    midenFaucetId: '0xbbbbbbbbbbbbbbbb',
    midenDecimals: 6,
    midenReclaimHeight: 123456,
    evmRecipient: '0x1111111111111111111111111111111111111111',
    destinationChainId: 11155111,
    outputTokenAddress: '0x2222222222222222222222222222222222222222',
    minTokenOut: '1000000000000000000',
    ...overrides,
  };
}

function evmToMidenParams(
  overrides: Partial<EVMToMidenIntentParams> = {},
): EVMToMidenIntentParams {
  return {
    sourceChainId: 11155111,
    destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
    evmSourceAddress: '0x1111111111111111111111111111111111111111',
    evmTokenAddress: '0x3333333333333333333333333333333333333333',
    midenRecipientId: '0xaaaaaaaaaaaaaaaa',
    midenFaucetId: '0xbbbbbbbbbbbbbbbb',
    minTokenOut: '500000',
    ...overrides,
  };
}

describe('formatQuoteTokenIn', () => {
  it('returns the placeholder for empty / zero input', () => {
    expect(formatQuoteTokenIn(undefined, 8)).toBe('calculated at execution');
    expect(formatQuoteTokenIn('', 8)).toBe('calculated at execution');
    expect(formatQuoteTokenIn('0', 8)).toBe('calculated at execution');
  });

  it('formats a base-unit integer string with the token decimals', () => {
    expect(formatQuoteTokenIn('1000000', 6)).toBe('1');
    expect(formatQuoteTokenIn('1099993', 6)).toBe('1.099993');
  });

  it('normalizes a human-readable decimal string', () => {
    expect(formatQuoteTokenIn('2.5', 6, 6)).toBe('2.5');
  });

  it('falls back to the raw string when it cannot be parsed', () => {
    expect(formatQuoteTokenIn('not-a-number', 6)).toBe('not-a-number');
  });
});

describe('buildEpochTaskDataParams (Miden → EVM)', () => {
  it('throws when midenReclaimHeight is missing — the bug-fix guard', () => {
    expect(() =>
      buildEpochTaskDataParams(midenToEvmParams({ midenReclaimHeight: undefined })),
    ).toThrow(/midenReclaimHeight is required/);
  });

  it('stringifies a provided reclaim height into extraData', () => {
    const out = buildEpochTaskDataParams(
      midenToEvmParams({ midenReclaimHeight: 987654 }),
    );
    expect(out.extraData.midenReclaimHeight).toBe('987654');
  });

  it('builds a P2IDE Miden-sourced envelope', () => {
    const out = buildEpochTaskDataParams(midenToEvmParams());
    expect(out.taskType).toBe('gettokenout');
    expect(out.intentData.isNative).toBe(false);
    expect(out.intentData.depositTokenAddress).toBe(ZERO_ADDRESS);
    expect(out.extraData.midenNoteType).toBe('P2IDE');
  });

  it('scales midenAmount by midenDecimals into base units', () => {
    const out = buildEpochTaskDataParams(
      midenToEvmParams({ midenAmount: '2', midenDecimals: 6 }),
    );
    expect(out.intentData.tokenInAmount).toBe('2000000');
  });

  it('treats an omitted midenAmount as the reverse-quote route (0)', () => {
    const out = buildEpochTaskDataParams(midenToEvmParams({ midenAmount: undefined }));
    expect(out.intentData.tokenInAmount).toBe('0');
  });

  it('stringifies the destination chain id and passes minTokenOut through', () => {
    const out = buildEpochTaskDataParams(
      midenToEvmParams({ destinationChainId: 11155111, minTokenOut: '42' }),
    );
    expect(out.intentData.destinationChainId).toBe('11155111');
    expect(out.intentData.minTokenOut).toBe('42');
  });
});

describe('buildEVMToMidenTaskDataParams (EVM → Miden)', () => {
  it('throws when neither evmAmount nor minTokenOut is set', () => {
    expect(() =>
      buildEVMToMidenTaskDataParams(
        evmToMidenParams({ evmAmount: undefined, minTokenOut: '' }),
      ),
    ).toThrow(/set minTokenOut/);
  });

  it('throws when destinationChainId is not the Miden virtual chain id', () => {
    expect(() =>
      buildEVMToMidenTaskDataParams(evmToMidenParams({ destinationChainId: 1 })),
    ).toThrow(/destinationChainId must be/);
  });

  it('builds a P2ID Miden-output envelope on the reverse-quote route', () => {
    const out = buildEVMToMidenTaskDataParams(evmToMidenParams());
    expect(out.intentData.isNative).toBe(false);
    expect(out.intentData.tokenInAmount).toBe('0');
    expect(out.intentData.outputTokenAddress).toBe(ZERO_ADDRESS);
    expect(out.extraData.midenNoteType).toBe('P2ID');
  });

  it('scales a fixed evmAmount by evmTokenDecimals (forward route)', () => {
    const out = buildEVMToMidenTaskDataParams(
      evmToMidenParams({ evmAmount: '5', evmTokenDecimals: 18 }),
    );
    expect(out.intentData.tokenInAmount).toBe('5000000000000000000');
  });

  it('defaults destinationChainId to the Miden virtual chain id when omitted', () => {
    const out = buildEVMToMidenTaskDataParams(
      evmToMidenParams({ destinationChainId: undefined as unknown as number }),
    );
    expect(out.intentData.destinationChainId).toBe(String(MIDEN_DESTINATION_CHAIN_ID));
  });
});
