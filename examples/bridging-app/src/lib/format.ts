import { formatUnits } from 'viem';

/**
 * Format a Miden asset balance for display.
 *
 * Why bigint-safe: Miden asset amounts are base-unit `bigint` values. Casting
 * to JavaScript `number` (or dividing by `10 ** decimals`) loses precision for
 * any amount beyond ~`2^53` base units, which is well within reach for normal
 * testnet balances (e.g. a 6-decimal faucet at 10M units = 10^13 base units is
 * already past the safe-integer ceiling for some divisors). Always feed bigint
 * to `viem`'s `formatUnits`, which returns a decimal string directly.
 *
 * Output rules:
 * - `amount = 0n` returns `"0"` (never `"0.0"` or `"0.000000"`).
 * - `decimals = undefined` returns the raw bigint as a string (no formatting
 *   attempt) — callers without metadata still get a deterministic, non-NaN
 *   value to render.
 * - Otherwise returns `formatUnits(amount, decimals)` with any trailing zero
 *   padding and dangling decimal point trimmed so `100000000n / 6` displays
 *   as `"100"`, not `"100.000000"`, and `1500000n / 6` displays as `"1.5"`.
 */
export function formatMidenAssetAmount(amount: bigint, decimals?: number): string {
  if (decimals == null) return amount.toString();
  if (amount === 0n) return '0';
  const raw = formatUnits(amount, decimals);
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '');
}
