# miden-tutorials

The goal of this repository is to provide clear and practical examples for interacting with the **Miden Rollup**. These examples are designed to ensure a smooth onboarding experience for developers exploring Miden's capabilities.

The tutorials target **Miden v0.17**: Rust client 0.17.2, protocol 0.17.1,
Web SDK 0.17.1, and React SDK 0.17.0. Run `yarn tutorials` against testnet,
or `TUTORIAL_NETWORK=devnet yarn tutorials` against devnet. Start with fresh
client databases when upgrading from v0.16. The bank example uses Miden
toolchain 0.17.0 and contract SDK `miden` 0.15.0; see its
[build instructions](examples/miden-bank/README.md).

This repository is organized into several parts:

1. **docs**, contains the README files for the tutorials and guides.
2. **examples**, contains complete example projects (e.g., the Miden Bank built with the Rust compiler).
3. **masm**, contains the Miden assembly notes, accounts, and scripts used in the examples.
4. **rust-client**, contains examples for interacting with the Miden Rollup using **Rust**.
5. **web-client**, contains examples for interacting with the Miden Rollup in the browser.

## Documentation

The documentation (tutorials) in the `docs` folder is built using Docusaurus and is automatically absorbed into the main [miden-docs](https://github.com/0xMiden/miden-docs) repository for the main documentation website. Changes to the `next` branch trigger an automated deployment workflow. The docs folder requires npm packages to be installed before building.

The documentation folder is also a Rust crate. Run `cargo test --doc` inside `docs/` to check the Rust examples in the tutorial markdowns.
