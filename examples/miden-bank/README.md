# Miden Bank

Companion code for the **Building a Bank with Miden Rust** tutorial.

**[Read the tutorial](https://docs.miden.xyz/builder/tutorials/miden-bank/)**

## Quick Start

Build all contracts:

```bash
miden --version
(cd contracts/bank-account && miden build)
(cd contracts/deposit-note && miden build)
(cd contracts/withdraw-request-note && miden build)
(cd contracts/init-tx-script && miden build)
```

Run integration tests:

```bash
cargo test -p integration
```

## Prerequisites

- Rust (nightly, configured via `rust-toolchain.toml`)
- [Miden CLI](https://docs.miden.xyz/builder/get-started/) (`midenup`)

## Testnet and fees

The `initialize` and `deposit` binaries target testnet. Each binary prints its new account ID and waits for a public P2ID containing native testnet tokens. Request the standard amount from the testnet faucet for that ID while the binary runs. The helper consumes the funding note, waits for commitment, and then continues. The bank includes `BasicWallet` so it can receive this note. No faucet request is made automatically.

The deposit binary attaches 1,000 native base units to the deposit note. Both binaries wait for the transactions to be committed and verify the resulting storage before reporting success. The native development profile enables optimizations so local proving stays within the network reference-block window.

The live bank uses `AuthSingleSig` with Falcon512Poseidon2. Its owner key is saved in `keystore/`, and the client signs bank transactions with that key. Keep this keystore when running the deposit binary against the bank. `NoAuth` is used only in the isolated MockChain tests; adding `BasicWallet` to a live bank without authentication would let anyone spend its vault assets.
