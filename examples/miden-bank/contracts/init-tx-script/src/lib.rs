// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the Account binding which wraps the bank-account component methods
use crate::bindings::Account;

/// Initialize Transaction Script
///
/// This transaction script initializes the bank account, enabling deposits.
/// It must be executed by the bank account owner before any deposits can be made.
///
/// # Flow
/// 1. Transaction is created with this script attached
/// 2. Script executes in the context of the bank account
/// 3. Calls `account.initialize()` to enable deposits
/// 4. Bank account is now "deployed" and visible on chain
///
/// # Arguments
/// * `_arg` - Transaction script argument (unused in this script)
/// * `account` - Mutable reference to the Account (bank component)
#[tx_script]
fn run(_arg: Word, account: &mut Account) {
    account.initialize();
}
