//! Keep the published, doctested recipe identical to the executable example.

#[test]
fn nft_recipe_matches_runnable_example() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let markdown =
        std::fs::read_to_string(root.join("../docs/src/rust-client/nft_mint_transfer.md"))
            .expect("the NFT recipe must exist");
    let binary = std::fs::read_to_string(root.join("src/bin/nft_mint_transfer.rs"))
        .expect("the runnable NFT example must exist");
    let (_, code) = markdown
        .split_once("```rust no_run\n")
        .expect("the complete recipe must be compiled as a doctest");
    let (code, _) = code.split_once("\n```").expect("the Rust fence must close");
    assert_eq!(
        code.trim(),
        binary.trim(),
        "recipe and executable have drifted"
    );
}
