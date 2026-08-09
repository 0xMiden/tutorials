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

## Reading fresh account state

Account values you already hold in a variable are snapshots and do not update automatically after a transaction or sync. When you need the latest account state, query the client's store again instead of continuing to inspect the old value.

`AccountReader` is designed for this: each async method reads the current value from storage. For example:

```rust ignore
client.sync_state().await?;
let reader = client.account_reader(account_id);
let balance = reader.get_balance(faucet_id).await?;
```

This is especially useful after consuming notes or submitting transactions, when an earlier `Account` value may no longer reflect the latest balance or nonce.

Keep in mind that both the Rust client and the documentation are works-in-progress!
