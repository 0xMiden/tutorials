---
title: Miden Node Setup
sidebar_position: 2
---

# Miden Node Setup Tutorial

To run the Miden tutorial examples, you connect to a Miden node. By default, **every tutorial in this book targets the public Miden testnet** — no local setup is required. If you would rather run against your own node, you can start a local network instead.

## Connecting to the Miden testnet

The tutorials use the public testnet by default. Its RPC endpoint is:

```bash
https://rpc.testnet.miden.io:443
```

This is the endpoint the examples pass to the client (`Endpoint::testnet()` in the Rust client), so they work out of the box with no additional setup.

## Running a local network

Running against a local network is optional and only needed for a fully self-hosted setup. The Miden node's own documentation covers standing up a local network end to end — installing the node, bootstrapping genesis, and starting the services:

- [Local network development](https://docs.miden.xyz/reference/node/local-network-development)

Network transactions additionally require the **network transaction builder** (`miden-ntx-builder`), the component that executes network notes on an account's behalf. The local-network setup linked above provisions it; a node without the builder will commit network notes but never execute them.

Once your local network is running, point the tutorials at its RPC endpoint instead of `Endpoint::testnet()`.
