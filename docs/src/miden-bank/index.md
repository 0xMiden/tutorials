---
sidebar_position: 4
title: "Building a Bank with Miden Rust"
description: "Learn Miden Rust compiler fundamentals by building a complete banking application with deposits, withdrawals, and asset management."
---

# Building a Bank with Miden Rust

Welcome to the **Miden Rust Compiler Tutorial**! This hands-on guide teaches you how to build smart contracts on Miden using Rust by walking through a complete banking application.

## What You'll Build

You'll create a **banking system** consisting of:

- **Bank Account Component**: A smart contract that manages depositor balances and vault operations
- **Deposit Note**: A note script that processes deposits into the bank
- **Withdraw Request Note**: A note script that requests withdrawals from the bank
- **Initialization Script**: A transaction script to deploy and initialize the bank

The tutorial includes runnable tests where appropriate — some parts are setup-only or conceptual, with the first runnable test in Part 4.

## Tutorial Structure

This tutorial is designed for hands-on learning. Each part builds on the previous one, and every part includes:

- **What You'll Build** - Clear objectives for the section
- **Step-by-step code** - Progressively building functionality
- **Verification steps** - Runnable tests, build checks, or code review
- **Complete code** - Full code listing for reference

### Parts Overview

| Part       | Topic                                                    | What You'll Build                   |
| ---------- | -------------------------------------------------------- | ----------------------------------- |
| **Part 0** | [Project Setup](./00-project-setup.md)                   | Create project with `miden new`     |
| **Part 1** | [Account Components](./01-account-components.md)         | Bank struct with storage            |
| **Part 2** | [Constants & Constraints](./02-constants-constraints.md) | Business rules and validation       |
| **Part 3** | [Asset Management](./03-asset-management.md)             | Deposit logic with balance tracking |
| **Part 4** | [Note Scripts](./04-note-scripts.md)                     | Deposit note for receiving assets   |
| **Part 5** | [Cross-Component Calls](./05-cross-component-calls.md)   | How bindings enable calls           |
| **Part 6** | [Transaction Scripts](./06-transaction-scripts.md)       | Initialization script               |
| **Part 7** | [Output Notes](./07-output-notes.md)                     | Withdraw with P2ID output           |
| **Part 8** | [Complete Flows](./08-complete-flows.md)                 | End-to-end verification             |

## Tutorial Cards

import DocCard from '@theme/DocCard';

<div className="row">
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/project-setup',
        label: 'Part 0: Project Setup',
        description: 'Create your project with miden new and understand the workspace structure.',
      }}
    />
  </div>
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/account-components',
        label: 'Part 1: Account Components',
        description: 'Learn #[component], Value storage, and StorageMap for managing state.',
      }}
    />
  </div>
</div>

<div className="row">
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/constants-constraints',
        label: 'Part 2: Constants & Constraints',
        description: 'Define business rules with constants and validate with assertions.',
      }}
    />
  </div>
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/asset-management',
        label: 'Part 3: Asset Management',
        description: 'Handle fungible assets with vault operations and balance tracking.',
      }}
    />
  </div>
</div>

<div className="row">
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/note-scripts',
        label: 'Part 4: Note Scripts',
        description: 'Write scripts that execute when notes are consumed.',
      }}
    />
  </div>
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/cross-component-calls',
        label: 'Part 5: Cross-Component Calls',
        description: 'Call account methods from note scripts via bindings.',
      }}
    />
  </div>
</div>

<div className="row">
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/transaction-scripts',
        label: 'Part 6: Transaction Scripts',
        description: 'Write scripts for account initialization and owner operations.',
      }}
    />
  </div>
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/output-notes',
        label: 'Part 7: Creating Output Notes',
        description: 'Create P2ID notes programmatically for withdrawals.',
      }}
    />
  </div>
</div>

<div className="row">
  <div className="col col--6">
    <DocCard
      item={{
        type: 'link',
        href: 'miden-bank/complete-flows',
        label: 'Part 8: Complete Flows',
        description: 'Walk through end-to-end deposit and withdraw operations.',
      }}
    />
  </div>
</div>

## Prerequisites

Before starting this tutorial, ensure you have:

- Completed the [Get Started guide](https://docs.miden.xyz/builder/get-started/) (familiarity with `midenup`, `miden new`, basic tooling)
- Basic understanding of Miden concepts (accounts, notes, transactions)
- Rust programming experience

:::tip No Miden Rust Experience Required
This tutorial assumes no prior experience with the Miden Rust compiler. We'll explain each concept as we encounter it.
:::

## Concepts Covered

This tutorial covers the following Miden Rust compiler features:

| Concept                      | Description                                                | Part |
| ---------------------------- | ---------------------------------------------------------- | ---- |
| `#[component]`               | Define account components with storage                     | 1    |
| Storage Types                | `Value` for single values, `StorageMap` for key-value data | 1    |
| Constants                    | Define compile-time business rules                         | 2    |
| Assertions                   | Validate conditions and handle errors                      | 2    |
| Asset Handling               | Add and remove assets from account vaults                  | 3    |
| `#[note]` + `#[note_script]` | Note struct/impl pattern for scripts consumed by accounts  | 4    |
| Cross-Component Calls        | Call account methods from note scripts                     | 5    |
| `#[tx_script]`               | Transaction scripts for account operations                 | 6    |
| Output Notes                 | Create notes programmatically                              | 7    |

## Source Code

The complete source code for this tutorial is available in the [examples/miden-bank](https://github.com/0xMiden/miden-tutorials/tree/main/examples/miden-bank) directory of this repository:

```bash title=">_ Terminal"
git clone https://github.com/0xMiden/miden-tutorials.git
cd miden-tutorials/examples/miden-bank
```

## Supplementary Guides

These standalone guides complement the tutorial:

- **[Testing with MockChain](https://docs.miden.xyz/builder/tutorials/rust-compiler/testing)** - Learn to test your contracts
- **[Debugging](https://docs.miden.xyz/builder/tutorials/rust-compiler/debugging)** - Troubleshoot common issues
- **[Common Pitfalls](https://docs.miden.xyz/builder/tutorials/rust-compiler/pitfalls)** - Avoid known gotchas

## Getting Help

If you get stuck during this tutorial:

- Check the [Miden Docs](https://docs.miden.xyz) for detailed technical references
- Join the [Build On Miden](https://t.me/BuildOnMiden) Telegram community for support
- Review the complete code in the [examples/miden-bank](https://github.com/0xMiden/miden-tutorials/tree/main/examples/miden-bank) directory

Ready to build your first Miden banking application? Let's get started with [Part 0: Project Setup](./00-project-setup.md)!
