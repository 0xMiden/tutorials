// Centralized explorer URL helpers. SIO surfaces a synthetic Miden settlement
// row using `chainId === MIDEN_CHAIN_ID` (999_999_999); everything else is an
// EVM chain mapped here.

export const MIDEN_CHAIN_ID = 999_999_999;

export const MIDENSCAN_BASE = 'https://testnet.midenscan.com';

const EVM_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  137: 'https://polygonscan.com',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  11155111: 'https://sepolia.etherscan.io',
  11155420: 'https://sepolia-optimism.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  80002: 'https://amoy.polygonscan.com',
};

export const explorerTxUrl = (
  chainId: number,
  hash: string,
): string | null => {
  if (chainId === MIDEN_CHAIN_ID) return `${MIDENSCAN_BASE}/tx/${hash}`;
  const base = EVM_EXPLORERS[chainId];
  return base ? `${base}/tx/${hash}` : null;
};

export const midenscanNoteUrl = (noteId: string): string =>
  `${MIDENSCAN_BASE}/note/${noteId}`;

export const truncateHash = (
  hash: string | null | undefined,
  head = 10,
  tail = 8,
): string => {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
};
