import { describe, it, expect } from 'vitest';
import {
  selectDestinationSettlement,
  parseDestinationChainId,
} from '../intentSettlement';

const row = (chainId: number, status: string, transactionHash = '') => ({
  chainId,
  status,
  transactionHash,
});

describe('selectDestinationSettlement', () => {
  it('ignores non-destination rows and waits while a destination row is pending', () => {
    const rows = [
      row(84532, 'success', '0xcompact'),
      row(11155111, 'pending', '0xdest'),
    ];
    const { completed, hasPending } = selectDestinationSettlement(rows, 11155111);
    expect(hasPending).toBe(true);
    expect(completed).toBeUndefined();
  });

  it('returns the last terminal-OK destination row once none are pending', () => {
    const rows = [
      row(84532, 'success', '0xcompact'),
      row(11155111, 'success', '0xfirst'),
      row(11155111, 'completed', '0xlast'),
    ];
    const { completed, hasPending } = selectDestinationSettlement(rows, 11155111);
    expect(hasPending).toBe(false);
    expect(completed?.transactionHash).toBe('0xlast');
  });

  // The pending GATE only changes behaviour when the destination chain carries a
  // terminal-OK row AND a pending row at the same time — exactly Brian's scenario
  // ("a prior-step success alongside an in-flight destination-chain tx"). Without
  // the gate, the success row would be reported as settled while a tx is still in
  // flight. This case fails if the `hasPending ? undefined :` gate is removed.
  it('blocks completion when a destination success row coexists with an in-flight pending row', () => {
    const rows = [
      row(11155111, 'success', '0xdone'),
      row(11155111, 'pending', '0xinflight'),
    ];
    const { completed, hasPending } = selectDestinationSettlement(rows, 11155111);
    expect(hasPending).toBe(true);
    expect(completed).toBeUndefined();
  });

  it('never selects an internal/non-destination success row as settlement', () => {
    const rows = [row(84532, 'success', '0xcompact')];
    const { completed } = selectDestinationSettlement(rows, 11155111);
    expect(completed).toBeUndefined();
  });

  it('requires a non-empty transactionHash on the terminal row', () => {
    const rows = [row(11155111, 'success', '')];
    const { completed } = selectDestinationSettlement(rows, 11155111);
    expect(completed).toBeUndefined();
  });

  it('is case-insensitive on status', () => {
    const rows = [row(11155111, 'SUCCESS', '0xok')];
    const { completed } = selectDestinationSettlement(rows, 11155111);
    expect(completed?.transactionHash).toBe('0xok');
  });

  it('reports incomplete (no first-non-Miden fallback) for a missing/invalid chain id', () => {
    const rows = [row(84532, 'success', '0xcompact')];
    expect(selectDestinationSettlement(rows, undefined).completed).toBeUndefined();
    expect(selectDestinationSettlement(rows, 0).completed).toBeUndefined();
    expect(selectDestinationSettlement(rows, -1).completed).toBeUndefined();
  });
});

describe('parseDestinationChainId', () => {
  it('parses string and number chain ids', () => {
    expect(parseDestinationChainId('11155111')).toBe(11155111);
    expect(parseDestinationChainId(11155111)).toBe(11155111);
    expect(parseDestinationChainId('999999999')).toBe(999999999);
  });

  it('rejects absent or non-positive values', () => {
    expect(parseDestinationChainId(undefined)).toBeUndefined();
    expect(parseDestinationChainId('')).toBeUndefined();
    expect(parseDestinationChainId('0')).toBeUndefined();
    expect(parseDestinationChainId('abc')).toBeUndefined();
  });
});
