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
    /// The key is derived by [`BankStorage::balance_key`] — see its docs for the exact
    /// `[depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]`
    /// layout. This isolates balances per depositor per asset type.
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
    fn initialize(&mut self);

    /// Get the bank-tracked balance for a depositor and specific asset type.
    ///
    /// Named `get_depositor_balance` (not `get_balance`) to avoid colliding with
    /// the built-in `ActiveAccount::get_balance` vault method that the account
    /// wrapper generates.
    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt;

    /// Deposit an asset into the bank for a specific depositor.
    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset);

    /// Withdraw assets back to the depositor.
    fn withdraw(&mut self, withdraw_asset: Asset, serial_num: Word, tag: Felt, note_type: Felt);
}

#[component]
impl Bank for BankStorage {
    fn initialize(&mut self) {
        // Check not already initialized
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 0,
            "Bank already initialized"
        );

        // Set initialized flag to 1
        let initialized_word = Word::from([felt!(1), felt!(0), felt!(0), felt!(0)]);
        self.initialized.set(initialized_word);
    }

    fn get_depositor_balance(&self, depositor: AccountId, asset: Asset) -> Felt {
        self.balances.get(BankStorage::balance_key(depositor, &asset))
    }

    fn deposit(&mut self, depositor: AccountId, deposit_asset: Asset) {
        // Ensure the bank is initialized before accepting deposits
        self.require_initialized();

        // Verify this is a fungible asset.
        // For fungible assets, value = [amount, 0, 0, 0]; value[1] is always 0.
        assert!(
            deposit_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        // Extract the fungible amount from the asset value word
        let deposit_amount = deposit_asset.value[0];

        // Validate deposit amount does not exceed maximum
        assert!(
            deposit_amount.as_canonical_u64() <= MAX_DEPOSIT_AMOUNT,
            "Deposit amount exceeds maximum allowed"
        );

        // Derive the balance-map key from the depositor and the asset's faucet.
        let key = BankStorage::balance_key(depositor, &deposit_asset);

        // Update balance in integer space to avoid modular Felt wraparound.
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

        // Add asset to the bank's vault
        native_account::add_asset(deposit_asset);
    }

    fn withdraw(
        &mut self,
        withdraw_asset: Asset,
        serial_num: Word,
        tag: Felt,
        note_type: Felt,
    ) {
        // Ensure the bank is initialized before processing withdrawals
        self.require_initialized();

        // Identify the depositor from the note's sender — this is cryptographically
        // bound to the note metadata, so it cannot be spoofed by a malicious caller.
        let depositor = active_note::get_sender();

        // Verify this is a fungible asset — see `deposit()` for the rationale.
        assert!(
            withdraw_asset.value[1].as_canonical_u64() == 0,
            "Only fungible assets are supported"
        );

        // Extract the fungible amount from the asset value word
        let withdraw_amount = withdraw_asset.value[0];

        // Derive the balance-map key from the depositor and the asset's faucet.
        let key = BankStorage::balance_key(depositor, &withdraw_asset);

        // Get current balance and validate sufficient funds exist.
        let current_balance: Felt = self.balances.get(key);
        assert!(
            current_balance.as_canonical_u64() >= withdraw_amount.as_canonical_u64(),
            "Withdrawal amount exceeds available balance"
        );

        // Update balance: current - withdraw_amount
        let new_balance = current_balance - withdraw_amount;
        self.balances.set(key, new_balance);

        // Read the P2ID script root from the withdraw-request note's storage (items 10-13).
        let storage = active_note::get_storage();
        let script_root = Word::from([storage[10], storage[11], storage[12], storage[13]]);

        // Create a P2ID note to send the requested asset back to the depositor
        self.create_p2id_note(serial_num, &withdraw_asset, depositor, tag, note_type, script_root);
    }
}

/// Internal helpers that are not part of the component's exported WIT API.
///
/// The `#[component]` macro exports only the methods of the `Bank` trait, so these
/// inherent methods stay private to the contract.
impl BankStorage {
    /// Derive the `balances` map key identifying a (depositor, faucet) pair:
    /// `[depositor.prefix, depositor.suffix, faucet_prefix, faucet_suffix(+metadata)]`.
    ///
    /// `asset.key[3]` is the faucet id prefix; `asset.key[2]` is the faucet id suffix
    /// with the asset's metadata byte (composition + callback flag) folded into its low
    /// 8 bits — that is the v0.15 fungible-asset vault-key layout, so `key[2]` is NOT the
    /// raw faucet suffix. For the callbacks-disabled fungible assets this bank accepts the
    /// metadata byte is constant, so `(key[3], key[2])` is a stable per-faucet identifier.
    /// (The host-side mirror is `FungibleAsset::to_key_word()` indices `[3]`/`[2]`.)
    fn balance_key(depositor: AccountId, asset: &Asset) -> Word {
        Word::from([
            depositor.prefix,
            depositor.suffix,
            asset.key[3],
            asset.key[2],
        ])
    }

    /// Check that the bank is initialized.
    ///
    /// # Panics
    /// Panics if the bank has not been initialized.
    fn require_initialized(&self) {
        let current: Word = self.initialized.get();
        assert!(
            current[0].as_canonical_u64() == 1,
            "Bank not initialized - deposits not enabled"
        );
    }

    /// Create a P2ID (Pay-to-ID) note to send assets to a recipient.
    ///
    /// The P2ID script root is read from the active note's storage by the caller.
    fn create_p2id_note(
        &mut self,
        serial_num: Word,
        asset: &Asset,
        recipient_id: AccountId,
        tag: Felt,
        note_type: Felt,
        script_root: Word,
    ) {
        // Convert the passed tag Felt to a Tag and note_type Felt to a NoteType.
        // note_type: 1 = Public (stored on-chain), 2 = Private (off-chain)
        let tag = Tag::from(tag);
        let note_type = NoteType::from(note_type);

        // Compute the recipient hash from serial_num, the P2ID script root, and the
        // target account ID [suffix, prefix]. This matches the standard P2ID recipient
        // format used by miden-standards.
        let recipient = note::build_recipient(
            serial_num,
            script_root,
            vec![
                recipient_id.suffix,
                recipient_id.prefix,
            ],
        );

        // Create the output note
        let note_idx = output_note::create(tag, note_type, recipient);

        // Remove the asset from the bank's vault
        native_account::remove_asset(*asset);

        // Add the asset to the output note
        output_note::add_asset(*asset, note_idx);
    }
}
