import { useEffect, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { MidenAccount, EVMToMidenIntentParams } from '../../types/miden';
import { MIDEN_DESTINATION_CHAIN_ID } from '../../constants/chains';
import { formatQuoteTokenIn, type EVMToMidenQuote } from '../../services/epoch-bridge';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';

// EVM-side token decimals. The Epoch test ERC-20s on Sepolia are 18-decimal
// (verified on-chain); these must match the same addresses in IntentForm's
// SEPOLIA_TOKENS so a fixed-amount withdraw scales `evmAmount` correctly.
const SEPOLIA_TOKENS = [
  { symbol: 'USDC', address: '0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69', decimals: 18 },
  { symbol: 'USDT', address: '0xc04d2869665Be874881133943523723Be5782720', decimals: 18 },
  { symbol: 'Custom', address: '', decimals: 18 },
];

const TOKEN_CUSTOM = '__custom__';

function toNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

interface Props {
  accounts: MidenAccount[];
  onFetchQuote: (params: EVMToMidenIntentParams) => Promise<void>;
  onConfirmWithdraw: () => Promise<unknown>;
  onClearQuote: () => void;
  pendingQuote: EVMToMidenQuote | null;
  isFetchingQuote: boolean;
  isLoading: boolean;
  isSDKReady: boolean;
}

export function WithdrawForm({
  accounts,
  onFetchQuote,
  onConfirmWithdraw,
  onClearQuote,
  pendingQuote,
  isFetchingQuote,
  isLoading,
  isSDKReady,
}: Props) {
  const [evmToken, setEvmToken] = useState(SEPOLIA_TOKENS[0].address);
  const [customToken, setCustomToken] = useState('');
  const [minTokenOut, setMinTokenOut] = useState('1000000');
  const [midenRecipientId, setMidenRecipientId] = useState(() => accounts[0]?.id ?? '');
  const [midenFaucetId, setMidenFaucetId] = useState('0x0a7d175ed63ec5200fb2ced86f6aa5');
  const [status, setStatus] = useState('');

  const { address: connectedAddress } = useAccount();
  const walletChainId = useChainId();

  useEffect(() => {
    if (!midenRecipientId && accounts[0]?.id) {
      setMidenRecipientId(accounts[0].id);
    }
  }, [accounts, midenRecipientId]);

  const tokenSelectValue = evmToken === '' ? TOKEN_CUSTOM : evmToken;
  const resolvedFaucetId = midenFaucetId.trim();

  const finalToken = customToken || evmToken;
  const selectedToken = SEPOLIA_TOKENS.find((t) => t.address === finalToken);
  const evmDisplayDecimals =
    toNumberOrUndefined((pendingQuote?.quoteResult as any)?.tokenInDecimals) ??
    selectedToken?.decimals ??
    18;

  const buildParams = (): EVMToMidenIntentParams => {
    if (!connectedAddress) {
      throw new Error('Connect EVM wallet first');
    }
    return {
      sourceChainId: walletChainId,
      destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
      evmSourceAddress: connectedAddress,
      evmTokenAddress: finalToken,
      evmTokenDecimals: selectedToken?.decimals ?? 18,
      midenRecipientId,
      midenFaucetId: resolvedFaucetId,
      minTokenOut: minTokenOut.trim(),
    };
  };

  const canQuote =
    isSDKReady &&
    !!connectedAddress &&
    walletChainId > 0 &&
    !!midenRecipientId &&
    !!resolvedFaucetId &&
    !!(customToken || evmToken) &&
    minTokenOut.trim() !== '' &&
    minTokenOut.trim() !== '0' &&
    true;

  const handleGetQuote = () => {
    if (!finalToken || finalToken === '0x0000000000000000000000000000000000000000') {
      toast.error('Select or enter a valid source token address');
      return;
    }
    void toast.promise(
      (async () => {
        setStatus('Fetching withdraw quote…');
        await onFetchQuote(buildParams());
        setStatus('Quote ready — review below, then confirm.');
        return 'Quote ready';
      })(),
      {
        loading: 'Fetching quote…',
        success: (msg) => msg,
        error: (err) => {
          const msg = err instanceof Error ? err.message : 'Quote failed';
          setStatus(msg);
          return msg;
        },
      },
    );
  };

  const handleConfirm = () => {
    void toast.promise(
      (async () => {
        setStatus('Submitting withdraw intent…');
        const result = await onConfirmWithdraw();
        if (result && typeof result === 'object' && 'error' in result && (result as { error?: string }).error) {
          throw new Error((result as { error: string }).error);
        }
        setStatus('Withdraw intent submitted successfully.');
        return 'Withdraw intent submitted';
      })(),
      {
        loading: 'Confirming withdraw…',
        success: (msg) => msg,
        error: (err) => {
          const msg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
          setStatus(msg);
          return msg;
        },
      },
    );
  };

  return (
    <div className="ui-card">
      <h2 className="text-base font-semibold text-neutral-900">Intent details</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        Pay ERC-20 on the EVM chain below, set min Miden out, then <strong>Get quote</strong> (same allocator flow as
        Cross-chain deposit).
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <Label>Source EVM token (Sepolia)</Label>
          <SelectRoot
            value={tokenSelectValue}
            onValueChange={(v) => {
              if (v === TOKEN_CUSTOM) {
                setEvmToken('');
                setCustomToken('');
              } else {
                setEvmToken(v);
                setCustomToken('');
              }
              onClearQuote();
            }}
          >
            <SelectTrigger aria-label="Select EVM token">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              {SEPOLIA_TOKENS.map((token) => (
                <SelectItem key={token.symbol} value={token.address === '' ? TOKEN_CUSTOM : token.address}>
                  {token.symbol}
                  {token.address ? ` · ${token.address.slice(0, 10)}…` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>

        {evmToken === '' && (
          <div>
            <Label htmlFor="wd-custom">Custom token address</Label>
            <Input
              id="wd-custom"
              value={customToken}
              onChange={(e) => {
                setCustomToken(e.target.value);
                onClearQuote();
              }}
              placeholder="0x…"
              className="font-mono text-[13px]"
            />
          </div>
        )}

        <div>
          <Label htmlFor="wd-min-token-out">
            Min Miden tokens to receive{' '}
            <span className="text-xs font-normal text-neutral-500">
              (base units — maps directly to intent <code className="text-[11px]">minTokenOut</code>)
            </span>
          </Label>
          <Input
            id="wd-min-token-out"
            value={minTokenOut}
            onChange={(e) => {
              setMinTokenOut(e.target.value);
              onClearQuote();
            }}
            placeholder="e.g. 10"
          />
        </div>

        <div>
          <Label>EVM source wallet</Label>
          <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-[13px] text-neutral-600 break-all">
            {connectedAddress ?? <span className="text-amber-700">Connect EVM wallet above</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Destination (Miden wallet)</Label>
            <Input type="text" value={midenRecipientId} onChange={(e) => setMidenRecipientId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="wd-faucet-id">Miden faucet ID</Label>
            <Input
              id="wd-faucet-id"
              value={midenFaucetId}
              onChange={(e) => {
                setMidenFaucetId(e.target.value);
                onClearQuote();
              }}
              placeholder="Paste faucet account ID"
              className="font-mono text-[13px]"
            />
          </div>
        </div>

        {pendingQuote && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-900">Quote</span>
              <button type="button" className="text-xs text-neutral-500 underline" onClick={onClearQuote}>
                Clear quote
              </button>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-700">Required deposit</p>
              <p className="mt-1 font-mono text-xl font-semibold text-orange-900">
                {formatQuoteTokenIn(
                  pendingQuote.quoteResult.tokenIn,
                  evmDisplayDecimals,
                  toNumberOrUndefined((pendingQuote.quoteResult as any)?.tokenInDecimals),
                ) || 'calculated at execution'}{' '}
                {pendingQuote.quoteResult.tokenInSymbol ?? selectedToken?.symbol ?? 'tokens'}
              </p>
            </div>
            <p className="text-xs text-neutral-500 italic">
              Keep at least this amount in your EVM wallet before confirming.
            </p>
          </div>
        )}

        {!pendingQuote ? (
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleGetQuote}
            disabled={isFetchingQuote || !canQuote}
          >
            {isFetchingQuote ? 'Fetching quote…' : 'Get quote'}
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing…' : 'Confirm & sign'}
          </Button>
        )}

        {!isSDKReady && (
          <p className="text-xs text-amber-800">Epoch SDK not ready — connect your EVM wallet above.</p>
        )}

        {status && (
          <p className={`text-sm ${status.startsWith('Error') ? 'text-red-600' : 'text-amber-800'}`}>{status}</p>
        )}
      </div>
    </div>
  );
}
