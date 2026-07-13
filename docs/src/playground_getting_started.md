---
title: Getting Started with Miden Playground
sidebar_position: 5
---

# Getting Started with Miden Playground

The [Miden Playground](https://playground.miden.xyz) is a browser-based environment that lets you write, compile, and deploy Miden smart contracts without installing any local tools.

## Prerequisites

- A modern browser (Chrome or Firefox recommended)
- [Miden Wallet browser extension](https://chromewebstore.google.com/detail/miden-wallet/afkbfpajhbkooldkoggjfmicfflmmhbj)
- No Rust or local toolchain required

## Overview

The Playground provides:
- **Scripts editor** — write Account Components and Note Scripts in Rust
- **Accounts** — create and manage local accounts and smart contracts
- **Notes** — create, send, and consume notes
- **Transactions** — view transaction history and status

## Step 1: Install Miden Wallet Extension

Before using the Playground, install the Miden Wallet browser extension. This is required to sign transactions.

1. Visit the [Chrome Web Store](https://chromewebstore.google.com/detail/miden-wallet/afkbfpajhbkooldkoggjfmicfflmmhbj)
2. Click **Add to Chrome**
3. Pin the extension to your browser toolbar
4. Open the extension and create a new wallet
5. Save your seed phrase securely

## Step 2: Create Your First Account

1. Open [playground.miden.xyz](https://playground.miden.xyz)
2. In the left sidebar, click **Accounts**
3. Click **"Create new account"** → select **"Basic Wallet"**
4. Give it a name (e.g. `my-wallet`)
5. Click **Create**

## Step 3: Get Test Tokens from Faucet

1. In the sidebar, click **Accounts** → select your wallet
2. Click **"Add Funds"** or navigate to the **Miden Faucet**
3. Request testnet tokens
4. Wait for the note to appear in your **Notes** tab
5. Consume the note to receive tokens into your account

## Step 4: Send Your First Transaction

1. Go to **Notes** → click **"Add note"** → **"Send assets"**
2. Select your wallet as the sender
3. Enter a recipient address
4. Set the amount and note type (Public)
5. Click **Create** → sign via the Miden Wallet extension
6. Wait for network confirmation (may take 1-3 minutes due to ZK proof generation)

## Step 5: Deploy a Smart Contract

The Playground supports deploying custom smart contracts using Miden's component-based architecture.

### Writing an Account Component

1. Go to **Scripts** → click **"Create new script"**
2. Select **Type: Account Component**
3. Choose an **Example** template to start from
4. Modify the Rust code as needed
5. Click **Compile** (this may take 1-3 minutes)

### Deploying the Contract

1. Go to **Accounts** → **"Create new account"** → **"Deploy account"**
2. Select your compiled Account Component
3. Choose **Auth Component** (No Auth for public contracts)
4. Click **Deploy**

## Step 6: Interact via Note Scripts

Note scripts are the mechanism for interacting with smart contracts in Miden.

1. Go to **Scripts** → **"Create new script"**
2. Select **Type: Note Script**
3. Add your Account Component as a dependency in the **Metadata** tab
4. Write your interaction logic
5. Compile the script
6. Go to **Notes** → **"Add note"** → **"Create note"**
7. Select your contract and note script
8. Sign and submit

## Performance Notes

- **Compilation** takes 1-3 minutes due to ZK proof generation
- **Transactions** take 1-5 minutes to be acknowledged by the network  
- Do not close or refresh the browser tab during compilation or transaction signing

## Tutorials Available in the Playground

The Playground has built-in tutorials covering:

| Tutorial | Level | Description |
|----------|-------|-------------|
| Basic wallet | Beginner | Create wallet, request funds, send tokens |
| P2ID note | Beginner | Pay-to-ID note pattern |
| P2IDR note | Beginner | Pay-to-ID with recall |
| Timelock P2ID | Intermediate | Time-locked payments |
| Network transactions | Intermediate | On-chain smart contract execution |
| Counter Contract | Advanced | Deploy and interact with a custom smart contract |
| Contract verification | Advanced | Deploy and verify contracts on-chain |

## Troubleshooting

**Compilation fails:**
- Refresh the page and try again
- Check browser console for errors
- Ensure your script has no syntax errors

**Transaction not appearing:**
- Click the Miden Wallet extension icon to trigger signing
- Check the **History** tab and retry consumption if needed
- Network may be congested — wait a few minutes

**Proof generation fails:**
- Go to **History** tab
- Find the failed transaction
- Click **Consume** to retry

## Next Steps

- Explore the [Counter Contract tutorial](./web-client/counter_contract_tutorial.md) for a deeper dive into smart contracts
- Learn about [Note Scripts](./web-client/mint_consume_create_tutorial.md) 
- Join the [Miden Telegram](https://t.me/BuildOnMiden/1) community

