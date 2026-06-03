/**
 * Tests for formatMidenAssetAmount — the bigint-safe Miden balance formatter
 * surfaced in the bridging app's Cross-chain Source-asset dropdown and Balance
 * label. The earlier raw `amount.toString()` display showed a 1-USDC balance
 * on a 6-decimal faucet as `1000000` instead of `1`. These cases pin down the
 * decimal-rule contract listed in `TASK-final-revision-post-human-check-8.9.md`.
 */

import { describe, it, expect } from 'vitest';

import { formatMidenAssetAmount } from '../format';

describe('formatMidenAssetAmount', () => {
  it('formats whole-number balances without trailing zeros (100000000 base units / 6 decimals → "100")', () => {
    expect(formatMidenAssetAmount(100_000_000n, 6)).toBe('100');
  });

  it('formats sub-unit fractions correctly (100 base units / 6 decimals → "0.0001")', () => {
    expect(formatMidenAssetAmount(100n, 6)).toBe('0.0001');
  });

  it('renders zero as a plain "0" regardless of decimals', () => {
    expect(formatMidenAssetAmount(0n, 6)).toBe('0');
    expect(formatMidenAssetAmount(0n, 0)).toBe('0');
    expect(formatMidenAssetAmount(0n, 18)).toBe('0');
  });

  it('falls back to the raw bigint string when decimals is undefined', () => {
    expect(formatMidenAssetAmount(123_456n)).toBe('123456');
    expect(formatMidenAssetAmount(0n)).toBe('0');
  });

  it('handles 18-decimal whole units and partial values', () => {
    expect(formatMidenAssetAmount(1_000_000_000_000_000_000n, 18)).toBe('1');
    expect(formatMidenAssetAmount(1_500_000_000_000_000_000n, 18)).toBe('1.5');
  });

  it('preserves precision past the JS safe-integer ceiling', () => {
    // 10^16 base units / 6 decimals = 10_000_000_000 tokens — well past
    // `Number.MAX_SAFE_INTEGER / 1e6`, where a `Number`-based formatter would
    // start losing precision.
    expect(formatMidenAssetAmount(10n ** 16n, 6)).toBe('10000000000');
  });
});
