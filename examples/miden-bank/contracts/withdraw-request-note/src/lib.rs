// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

// Import the bank account's generated bindings
use crate::bindings::miden::bank_account::bank_account;

/// Withdraw Request Note Script
///
/// When consumed by the Bank account, this note requests a withdrawal and
/// the bank creates a P2ID note to send assets back to the depositor.
///
/// # Flow
/// 1. Note is created by a depositor specifying the withdrawal details
/// 2. Bank account consumes this note
/// 3. Note script reads the sender (depositor) and storage items
/// 4. Calls `bank_account::withdraw(depositor, asset, serial_num, tag, note_type, script_root)`
/// 5. Bank updates the depositor's balance
/// 6. Bank creates a P2ID note with the specified parameters to send assets back
///
/// # Note Storage (14 Felts)
/// [0-3]: withdraw asset key (0, 0, faucet_suffix, faucet_prefix)
///        and value (amount, 0, 0, 0) - encoded as [amount, 0, faucet_suffix, faucet_prefix]
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
/// [10-13]: P2ID script_root (MAST root of the P2ID note script, Poseidon2-hashed)
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get the storage items
        let storage = active_note::get_storage();

        // Asset: reconstruct from [amount, 0, faucet_suffix, faucet_prefix] encoding
        // key = [0, 0, faucet_suffix, faucet_prefix]
        // value = [amount, 0, 0, 0]
        let withdraw_asset = Asset::new(
            Word::from([felt!(0), felt!(0), storage[2], storage[3]]),
            Word::from([storage[0], felt!(0), felt!(0), felt!(0)]),
        );

        // Serial number: full 4 Felts (random/unique per note)
        let serial_num = Word::from([storage[4], storage[5], storage[6], storage[7]]);

        // Tag: single Felt for P2ID note routing
        let tag = storage[8];

        // Note type: 1 = Public, 2 = Private
        let note_type = storage[9];

        // Note: P2ID script root (storage[10..13]) is read by the bank account directly
        // from the active note's storage inside `bank_account::withdraw`, avoiding the
        // WIT flat-params limit (≤ 16) that would be exceeded if passed as a parameter.

        // Call the bank account to withdraw the assets
        bank_account::withdraw(depositor, withdraw_asset, serial_num, tag, note_type);
    }
}
