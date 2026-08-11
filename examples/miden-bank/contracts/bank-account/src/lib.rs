// Do not link against libstd (i.e. anything defined in `std::`)
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

use miden::Felt;

/// Maximum allowed deposit amount per transaction.
///
/// This limit provides a safety constraint for the banking system.
///
/// Value: 1,000,000 tokens (arbitrary limit for demonstration)
///
/// # Implementation Notes
/// In Miden Rust contracts, constants are defined using standard Rust `const` syntax.
/// The value is a u64 which can be compared against a Felt's underlying representation
/// using the `as_canonical_u64()` method.
///
/// # Error Handling
/// When this limit is exceeded, the contract uses `assert!()` to fail the transaction.
/// In the Miden VM, a failed assertion means the proof cannot be generated,
/// effectively rejecting the transaction at the proving stage.
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000;

/// Maximum allowed balance per depositor per asset.
///
/// This matches `FungibleAsset::MAX_AMOUNT` (2^63 - 2^31) from the Miden protocol.
/// Felt arithmetic is modular (wraps at the Goldilocks prime), so without this guard
/// a cumulative balance could silently wrap around to zero. Validating the u64 result
/// of the addition against this bound prevents that overflow.
const MAX_BALANCE: u64 = 9_223_372_034_707_292_160; // 2^63 - 2^31

/// Storage layout for the bank account component.
///
/// Users deposit assets via deposit notes, and the bank tracks
/// each depositor's balance in a storage map keyed by their AccountId.
///
/// The bank must be initialized before deposits are accepted. This is done
/// via a transaction script that calls the `initialize()` method.
#[component_storage]
struct BankStorage {
    /// Tracks whether the bank has been initialized (deposits enabled).
    /// Word layout: [is_initialized (0 or 1), 0, 0, 0]
    /// Must be set to 1 via `initialize()` before deposits are accepted.
    #[storage(description = "initialized")]
    initialized: StorageValue<Word>,

    /// Maps (depositor AccountId, faucet ID) -> balance (as Felt).
    /// Key is derived as: [depositor.prefix, depositor.suffix, faucet_prefix (asset.key[3]), faucet_suffix (asset.key[2])],
    /// which isolates balances per depositor per asset type.
    ///
    /// Note (v0.15): the asset's metadata byte (composition + callback flag) is folded
    /// into the low 8 bits of the faucet-suffix limb (`asset.key[2]`), so that limb is
    /// NOT the raw faucet suffix. For the callbacks-disabled fungible assets this bank
    /// accepts the metadata byte is constant, so the derived key is still a stable
    /// per-depositor-per-faucet identifier.
    #[storage(description = "balances")]
    balances: StorageMap<Word, Felt>,
}

/// API of the bank account component.
#[component]
trait Bank {
    /// Initialize the bank account, enabling deposits.
    ///
    /// This function should be called via a transaction script by the account owner.
    /// Once initialized, the bank can accept deposits. This also serves to "deploy"
    /// the account on-chain (accounts are only visible after their first state change).
    ///
    /// # Panics
    /// Panics if the bank is already initialized.
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    ///
    /// Named `get_depositor_balance` (not `get_balance`) to avoid colliding with
    /// the built-in `ActiveAccount::get_balance` vault method that the account
    /// wrapper generates.
    ///
    /// # Arguments
    /// * `depositor` - The AccountId to query the balance for
    /// * `asset` - The asset type to query (used to derive the faucet portion of the key)
    ///
    /// # Returns
    /// The depositor's current balance as a Felt for the given asset type
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;

    /// Deposit an asset into the bank for a specific depositor.
    ///
    /// Named `bank_deposit` (not `deposit`) to avoid colliding with the built-in
    /// `BasicWallet::deposit` method when FPI bindings are generated.
    ///
    /// The asset is added to the bank's vault and the depositor's
    /// balance is updated in the mapping.
    ///
    /// # Arguments
    /// * `depositor` - The AccountId of the user making the deposit
    /// * `deposit_asset` - The fungible asset being deposited
    ///
    /// # Panics
    /// Panics if the asset is non-fungible.
    /// Panics if the deposit amount exceeds `MAX_DEPOSIT_AMOUNT`.
    /// Panics if the resulting balance would exceed `MAX_BALANCE` (u64 overflow).
    /// Panics if the bank has not been initialized.
    fn bank_deposit(&mut self, depositor: AccountId, deposit_asset: Asset);

    /// Withdraw assets back to the depositor.
    ///
    /// Creates a P2ID note that sends the requested asset to the depositor's account.
    /// The depositor is identified via `active_note::get_sender()`, which is
    /// cryptographically bound to the consumed note's metadata — this prevents an
    /// attacker from passing a victim's account ID to drain their balance.
    ///
    /// # Arguments
    /// * `withdraw_asset` - The fungible asset to withdraw
    /// * `serial_num` - Unique serial number for the P2ID output note
    /// * `tag` - The note tag for the P2ID output note (allows caller to specify routing)
    /// * `note_type` - Note type: 1 = Public (stored on-chain), 2 = Private (off-chain)
    ///
    /// The P2ID script root is read from the active note's storage (items 10-13).
    ///
    /// # Panics
    /// Panics if the asset is non-fungible.
    /// Panics if the withdrawal amount exceeds the depositor's current balance.
    /// Panics if the bank has not been initialized.
    fn withdraw(&mut self, withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);
}

#[component]
impl Bank for BankStorage {
    fn initialize(&mut self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt {
        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3],
            asset.key[2],
        ]);
        self.balances.get(key)
    }

    fn bank_deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        self.require_initialized();

        assert!(
            deposit_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        let deposit_amount = deposit_asset.value[0];

        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            deposit_asset.key[3],
            deposit_asset.key[2],
        ]);

        let current_balance: Felt = self.balances.get(key);
        let current_u64 = current_balance.as_canonical_u64();
        let deposit_u64 = deposit_amount.as_canonical_u64();

        let new_balance_u64 = current_u64
            .checked_add(deposit_u64)
            .expect("Balance overflow: addition exceeds u64 range");
        assert!(
            new_balance_u64 <= MAX_BALANCE,
            "Balance would exceed maximum allowed"
        );

        self.balances.set(key, Felt::new(new_balance_u64).unwrap());
        native_account::add_asset(deposit_asset);
    }

    fn withdraw(
        &mut self,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        self.require_initialized();

        let depositor = active_note::get_sender();

        assert!(
            withdraw_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        let withdraw_amount = withdraw_asset.value[0];

        let key = Word::from([
            depositor.prefix,
            depositor.suffix,
            withdraw_asset.key[3],
            withdraw_asset.key[2],
        ]);

        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        let storage = active_note::get_storage();
        let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);

        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type, script_root);
    }
}

impl BankStorage {
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }

    fn create_p2id_note(
        &mut self,
        serial_num: Word,
        asset: &Asset,
        recipient_id: AccountId,
        tag: Felt,
        note_type: Felt,
        script_root: Word,
    ) {
        let tag = Tag::from(tag);
        let note_type = NoteType::from(note_type);

        let recipient = note::build_recipient(
            serial_num,
            script_root,
            vec![
                recipient_id.suffix,
                recipient_id.prefix,
            ],
        );

        let note_idx = output_note::create(tag, note_type, recipient);
        native_account::remove_asset(*asset);
        output_note::add_asset(*asset, note_idx);
    }
}
