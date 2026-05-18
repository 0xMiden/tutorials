import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import App from "./App.tsx";
import { AppProviders } from "./providers";
import { hasRainbowKitProjectId } from "./config/wagmi";

const root = createRoot(document.getElementById("root")!);

if (!hasRainbowKitProjectId) {
  // Render a readable setup screen instead of crashing to a blank page when
  // VITE_RAINBOWKIT_PROJECT_ID is missing (e.g. .env.example copied verbatim).
  root.render(
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="ui-card max-w-md space-y-3">
        <h1 className="text-base font-semibold text-neutral-900">
          Configuration needed
        </h1>
        <p className="text-sm leading-relaxed text-neutral-600">
          <code className="font-mono text-[13px]">VITE_RAINBOWKIT_PROJECT_ID</code>{" "}
          is not set. Copy{" "}
          <code className="font-mono text-[13px]">.env.example</code> to{" "}
          <code className="font-mono text-[13px]">.env</code> and add a
          WalletConnect Cloud project id from{" "}
          <a
            href="https://cloud.walletconnect.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline"
          >
            cloud.walletconnect.com
          </a>
          , then restart the dev server.
        </p>
      </div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}
