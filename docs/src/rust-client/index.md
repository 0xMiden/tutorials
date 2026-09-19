---
title: "Rust Client"
sidebar_position: 1
---

# Rust Client

Rust library, which can be used to programmatically interact with the Miden rollup.

The Miden Rust client can be used for a variety of things, including:

- Deploying, testing, and creating transactions to interact with accounts and notes on Miden.
- Storing the state of accounts and notes locally.
- Generating and submitting proofs of transactions.

This section of the docs is an overview of the different things one can achieve using the Rust client, and how to implement them.

For complete runnable examples, browse the [`rust-client/src/bin`](https://github.com/0xMiden/tutorials/tree/main/rust-client/src/bin) source directory. Individual tutorials also link directly to their corresponding example where available.

## Running the v0.16 examples

The examples use Rust 1.98.1 and Miden v0.16. The repository includes the
required toolchain configuration and dependency lockfiles.

From the repository root, run the Rust tutorials on testnet with Node.js and Yarn:

```bash
yarn tutorials --rust
```

For devnet validation, run `TUTORIAL_NETWORK=devnet yarn tutorials --rust` instead.

The runner uses a fresh store for each example and deploys a counter before the
FPI and public-account interaction examples. The [oracle tutorial](./oracle_tutorial.md)
requires an external deployment and is excluded from the default run.

Testnet transactions pay fees in the native asset. The
shared helpers in `rust-client/src/lib.rs` in your v0.16 checkout
fund each executing account, synchronize before submission, and wait for confirmation.
They also filter `TX_FEE` notes when selecting tutorial notes. Set
`MIDEN_FAUCET_URL` if you need to override the network's public faucet API.

To follow a tutorial in a standalone project, clone this repository as `tutorials`
and create the project alongside it. The tutorial's `Cargo.toml` includes the
local `rust-client` dependency and development optimization profile. Follow its
commands to select the Rust toolchain and copy the repository's `Cargo.lock`.
Run the first build without `--locked` so Cargo can add the new project's package
entry to the lockfile.

Run standalone programs from their Cargo project directory. They load the shared
MASM files from `../tutorials/masm/`; the corresponding tutorial shows and explains
those sources. No additional MASM files need to be copied into the new project.

Keep in mind that both the Rust client and the documentation are works-in-progress!
