# Contributing to Miden Tutorials

#### First off, thanks for taking the time to contribute!

## Markdown Formatting with Prettier

We use [Prettier](https://prettier.io/) to ensure our Markdown files are consistently formatted.

### Installation

- **Global Installation:**

  ```bash
  npm install -g prettier
  ```

- **Local (Dev Dependency) Installation:**

  ```bash
  npm install --save-dev prettier
  ```

### Formatting Files

From the root of the project, run:

```bash
prettier --write "**/*.md"
```

Make sure to run this command before submitting pull requests.

## CodeSdkTabs: Dot-Indentation Convention

The `CodeSdkTabs` component (in `docs/src/components/CodeSdkTabs.tsx`) lets tutorials show React and TypeScript code side-by-side. Code is passed as template literals inside MDX props:

```mdx
<CodeSdkTabs
  example={{
    react: { code: `...` },
    typescript: { code: `...` },
  }}
  reactFilename="lib/example.tsx"
  tsFilename="lib/example.ts"
/>
```

**Problem:** MDX/webpack strips leading whitespace from template literals, so indented code renders flush-left.

**Solution:** Use leading dots (`.`) to represent indentation. Each dot equals one indent level (2 spaces). The `preserveIndent()` function in `CodeSdkTabs.tsx` converts dots to spaces at render time.

### Example

Source in `.md` file:

```
typescript: { code: `export function foo() {
.const x = 1;
.if (x) {
..console.log(x);
.}
}` }
```

Renders as:

```ts
export function foo() {
  const x = 1;
  if (x) {
    console.log(x);
  }
}
```

### Rules

| Context                                     | Dots | Spaces |
| ------------------------------------------- | ---- | ------ |
| Top-level (`export`, `import`, closing `}`) | 0    | 0      |
| Inside function body                        | 1    | 2      |
| Inside nested block (`if`, `for`, etc.)     | 2    | 4      |
| Function call arguments (continuation)      | +1   | +2     |
| Deeper nesting                              | 3+   | 6+     |

### Limitation: Leading-Dot Method Chains

Because `preserveIndent()` converts **all** leading dots to spaces, TypeScript method-chaining syntax (`.withFoo()`, `.build()`) breaks when it appears at the start of a line. The leading `.` is consumed as indentation.

**Workaround:** Assign the builder to a variable so the `.` appears mid-line:

```
// BAD – the leading dots get eaten:
..new TransactionRequestBuilder()
...withOwnOutputNotes(notes)
...build()

// GOOD – dots are mid-line, preserveIndent ignores them:
..const builder = new TransactionRequestBuilder();
..const request = builder.withOwnOutputNotes(notes).build();
```

### Tips

- Standalone code blocks (` ```ts...``` `) outside `CodeSdkTabs` use normal space indentation -- the dot convention only applies inside `CodeSdkTabs` template literals.
- The React and TypeScript code snippets both follow this convention. If you add or edit snippets, apply the same pattern.

---

Thank you for contributing!
