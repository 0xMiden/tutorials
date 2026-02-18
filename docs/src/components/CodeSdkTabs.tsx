import React, { useState } from "react";
import CodeBlock from "@theme/CodeBlock";
import styles from "./CodeSdkTabs.module.css";

interface CodeExample {
  react?: {
    code: string;
    output?: string;
  };
  typescript?: {
    code: string;
    output?: string;
  };
}

interface CodeSdkTabsProps {
  example: CodeExample;
  reactFilename?: string;
  tsFilename?: string;
}

// Dot-indentation convention for CodeSdkTabs
// ─────────────────────────────────────────────
// MDX/webpack strips leading whitespace from template literals inside JSX props.
// To preserve indentation in code snippets, use leading dots in the markdown
// source. Each dot represents one indent level (2 spaces).
//
// Example in a .md file:
//   typescript: { code: `export function foo() {
//   .const x = 1;
//   .if (x) {
//   ..console.log(x);
//   .}
//   }` }
//
// Renders as:
//   export function foo() {
//     const x = 1;
//     if (x) {
//       console.log(x);
//     }
//   }
//
// Rules:
//   0 dots  → top-level declarations (export, import, closing braces)
//   1 dot   → first level inside a function/block body
//   2 dots  → second level (nested blocks, function call arguments)
//   3+ dots → deeper nesting
function preserveIndent(code: string): string {
  return code.replace(/^(\.+)/gm, (match) => '  '.repeat(match.length));
}

export default function CodeSdkTabs({
  example,
  reactFilename = "index.tsx",
  tsFilename = "index.ts",
}: CodeSdkTabsProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<"react" | "typescript">(
    example.react ? "react" : "typescript"
  );

  const hasReact = !!example.react;
  const hasTypeScript = !!example.typescript;

  // Infer syntax language from filename extension (.tsx → tsx, .ts → ts)
  const langFor = (filename: string, fallback: string) =>
    filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") ? "ts" : fallback;

  // Don't show tabs if there's only one language
  if (!hasReact || !hasTypeScript) {
    const singleLang = hasReact ? "react" : "typescript";
    const singleExample = example[singleLang];
    const filename = singleLang === "react" ? reactFilename : tsFilename;

    return (
      <div className={styles.codeContainer}>
        <div className={styles.codeSection}>
          <CodeBlock
            language={langFor(filename, singleLang === "react" ? "tsx" : "ts")}
            title={filename}
          >
            {preserveIndent(singleExample!.code)}
          </CodeBlock>
        </div>
        {singleExample!.output && (
          <div className={styles.outputSection}>
            <div className={styles.outputHeader}>Output</div>
            <CodeBlock language="bash">{singleExample.output}</CodeBlock>
          </div>
        )}
      </div>
    );
  }

  const currentExample = example[activeTab];
  const activeFilename = activeTab === "react" ? reactFilename : tsFilename;

  return (
    <div className={styles.codeContainer}>
      <div className={styles.tabContainer}>
        <div className={styles.tabButtons}>
          <button
            className={`${styles.tabButton} ${
              activeTab === "react" ? styles.active : ""
            }`}
            onClick={() => setActiveTab("react")}
          >
            React
          </button>
          <button
            className={`${styles.tabButton} ${
              activeTab === "typescript" ? styles.active : ""
            }`}
            onClick={() => setActiveTab("typescript")}
          >
            TypeScript
          </button>
        </div>
      </div>

      <div className={styles.codeSection}>
        <CodeBlock
          language={langFor(activeFilename, activeTab === "react" ? "tsx" : "ts")}
          title={activeFilename}
        >
          {preserveIndent(currentExample!.code)}
        </CodeBlock>
      </div>

      {currentExample!.output && (
        <div className={styles.outputSection}>
          <div className={styles.outputHeader}>Output</div>
          <CodeBlock language="bash">{currentExample.output}</CodeBlock>
        </div>
      )}
    </div>
  );
}
