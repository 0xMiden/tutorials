---
title: Miden Node Setup
sidebar_position: 2
---

# Miden Node Setup Tutorial

The v0.17 client tutorials connect to public Miden testnet by default, so no local
node is required. You can also configure them to use your own network.

## Connecting to the public networks

The testnet RPC endpoint is:

```text
https://rpc.testnet.miden.io
```

Use `Endpoint::testnet()` in Rust or `MidenClient.createTestnet()` in the web SDK.
The tutorial runner selects testnet by default:

```bash
yarn tutorials
```

Testnet transactions pay fees in the native asset. The examples fund new accounts
from the public faucet before their first transaction. Use fresh local stores and
reassemble MASM sources when migrating from an earlier release.

## Running a local network

Running against a local network is optional and only needed for a fully self-hosted setup. The Miden node's own documentation covers standing up a local network end to end — installing the node, bootstrapping genesis, and starting the services:

- [Local network development](https://docs.miden.xyz/reference/node/local-network-development)

Network transactions additionally require the **network transaction builder** (`miden-ntx-builder`), the component that executes network notes on an account's behalf. The local-network setup linked above provisions it; a node without the builder will commit network notes but never execute them.

To use a local network, update the client's RPC endpoint and its address, native
asset, and faucet configuration to match that deployment. The runner's
`TUTORIAL_NETWORK` option accepts only `testnet` and `devnet`, not a local RPC URL.
