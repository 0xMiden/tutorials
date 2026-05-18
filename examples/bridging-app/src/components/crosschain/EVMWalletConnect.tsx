import { ConnectButton } from '@rainbow-me/rainbowkit';

export function EVMWalletConnect() {
  return (
    <div className="ui-card">
      <h2 className="text-lg font-semibold text-neutral-900">EVM wallet</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        Required for Epoch intents: signing and funding on Sepolia. Connect the wallet that should pay gas and hold
        destination tokens.
      </p>
      <div className="mt-4">
        <ConnectButton />
      </div>
    </div>
  );
}
