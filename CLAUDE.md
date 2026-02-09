# Miden Tutorials

## Markdown Formatting

This repo has a CI check that enforces markdown formatting via Prettier.

After making any changes to `.md` files, run:

```sh
npx prettier --check "**/*.md"
```

If it fails, fix with:

```sh
npx prettier --write "**/*.md"
```

The Prettier config is in `.prettierrc`. Files listed in `.prettierignore` are excluded from formatting.
