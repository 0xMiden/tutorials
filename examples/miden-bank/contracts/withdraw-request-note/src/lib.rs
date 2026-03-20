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
/// 3. Note script reads the sender (depositor) and inputs
/// 4. Calls `bank_account::withdraw(depositor, asset, serial_num, tag, note_type)`
/// 5. Bank updates the depositor's balance
/// 6. Bank creates a P2ID note with the specified parameters to send assets back
///
/// # Note Inputs (10 Felts)
/// [0-3]: withdraw asset (amount, 0, faucet_suffix, faucet_prefix)
/// [4-7]: serial_num (random/unique per note)
/// [8]: tag (P2ID note tag for routing)
/// [9]: note_type (1 = Public, 2 = Private)
#[note]
struct WithdrawRequestNote;

#[note]
impl WithdrawRequestNote {
    #[note_script]
    fn run(self, _arg: Word) {
        // The depositor is whoever created/sent this note
        let depositor = active_note::get_sender();

        // Get the inputs
        let inputs = active_note::get_inputs();

        // Asset: [amount, 0, faucet_suffix, faucet_prefix]
        let withdraw_asset = Asset::new(Word::from([inputs[0], inputs[1], inputs[2], inputs[3]]));

        // Serial number: full 4 Felts (random/unique per note)
        let serial_num = Word::from([inputs[4], inputs[5], inputs[6], inputs[7]]);

        // Tag: single Felt for P2ID note routing
        let tag = inputs[8];

        // Note type: 1 = Public, 2 = Private
        let note_type = inputs[9];

        // Call the bank account to withdraw the assets
        bank_account::withdraw(depositor, withdraw_asset, serial_num, tag, note_type);
    }
}
