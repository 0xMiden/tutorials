# Miden Bank

Companion code for the **Building a Bank with Miden Rust** tutorial.

**[Read the tutorial](https://docs.miden.xyz/builder/tutorials/miden-bank/)**

## Quick Start

Build all contracts:

```bash
cd contracts/bank-account && miden build
cd ../deposit-note && miden build
cd ../withdraw-request-note && miden build
cd ../init-tx-script && miden build
```

Run integration tests:

```bash
cargo test -p integration
```

## Prerequisites

- Rust (nightly, configured via `rust-toolchain.toml`)
- [Miden CLI](https://docs.miden.xyz/builder/get-started/) (`midenup`)
