// Application display name (used by wallet adapter).
export const APP_NAME = "Miden x Epoch Bridge";

// Miden SDK configuration — override via environment variables.
export const MIDEN_RPC_URL =
  import.meta.env.VITE_MIDEN_RPC_URL ?? "testnet";
export const MIDEN_PROVER =
  (import.meta.env.VITE_MIDEN_PROVER as "devnet" | "testnet" | "local") ?? "testnet";
