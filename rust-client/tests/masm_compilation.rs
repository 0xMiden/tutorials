//! Compile the standalone MASM artifacts that do not have a self-contained network run.

use miden_client::assembly::CodeBuilder;

#[test]
fn standalone_fee_auth_component_compiles() {
    CodeBuilder::new()
        .compile_component_code(
            "tutorials::auth",
            include_str!("../../masm/accounts/auth/no_auth.masm"),
        )
        .expect("the standalone no-auth component must support the v0.17 fee API");
}

#[test]
fn oracle_component_and_transaction_script_compile_without_a_deployment() {
    // These are assembly operands, not an oracle deployment or runtime price proof.
    let component_code = include_str!("../../masm/accounts/oracle_reader.masm")
        .replace("{pair_suffix}", "0")
        .replace("{pair_prefix}", "1")
        .replace(
            "{get_median_proc_root}",
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        )
        .replace("{oracle_id_prefix}", "1")
        .replace("{oracle_id_suffix}", "0");

    CodeBuilder::new()
        .compile_component_code("external_contract::oracle_reader", &component_code)
        .expect("the oracle reader component must assemble before a deployment is configured");
    CodeBuilder::new()
        .with_linked_module("external_contract::oracle_reader", &component_code)
        .unwrap()
        .compile_tx_script(include_str!("../../masm/scripts/oracle_reader_script.masm"))
        .expect("the oracle transaction must link its account procedure");
}
