# Miden Tutorials & Quickstart Guides

Welcome to the Miden Tutorials repository! This repository contains quickstart examples, smart contract execution flows, and guides to help developers build zero-knowledge applications on the Polygon Miden platform.

## Prerequisites

Before running the examples, ensure you have installed the following toolchain dependencies:

* **Rust** (latest stable version): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
* **Miden Client / CLI**: Follow the installation guide in the Miden Client Repository.
* **Cargo-make** (optional, for automation): `cargo install cargo-make`

## Getting Started

1. **Clone the repository:**
   `git clone https://github.com/0xMiden/miden-tutorials.git`
   `cd miden-tutorials`

2. **Build the examples:**
   `cargo build --release`

3. **Run a basic VM test transaction:**
   `cargo test`

## Resources & Documentation

* **Official Documentation:** https://docs.miden.xyz
* **Miden VM Repository:** https://github.com/0xMiden/miden-vm
* **Discord Community:** https://discord.gg/polygon

## Contributing

Contributions are welcome! If you find any issues, broken examples, or want to add a new tutorial:

1. Fork this repository.
2. Create a feature branch: `git checkout -b feature/new-tutorial`
3. Commit your changes: `git commit -m 'Add new tutorial'`
4. Push to the branch and open a Pull Request.
