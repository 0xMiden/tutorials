import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMidenFiWallet } from '@miden-sdk/miden-wallet-adapter-react';
import { SendTransaction } from '@miden-sdk/miden-wallet-adapter-base';
import { useSyncState } from '@miden-sdk/react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CrossChainIntentParams } from '../../types/miden';
import type { CrossChainQuote } from '../../services/epoch-bridge';
import { formatQuoteTokenIn } from '../../services/epoch-bridge';
import { formatMidenAssetAmount } from '../../lib/format';
import type { SolveIntentParams } from '@epoch-protocol/epoch-intents-sdk/dist/types';
import { DEFAULT_SEPOLIA_CHAIN_ID_STR } from '../../constants/chains';
import { useAccount } from 'wagmi';
import { useIntentTransactionStatus } from '../../hooks/useIntentTransactionStatus';

const SEPOLIA_TOKENS = [
  { symbol: 'USDC', address: '0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69', decimals: 18 },
  { symbol: 'DAI', address: '0xc30f1Ce05d1434d484E9A47283aA925fc8A8699a', decimals: 18 },
  { symbol: 'USDT', address: '0xc04d2869665Be874881133943523723Be5782720', decimals: 18 },
  { symbol: 'WETH', address: '0x7946dd86eE310D0aC16804A37787289Fa5b88A8A', decimals: 18 },
  { symbol: 'WBTC', address: '0x9b2a2754a9182fD65360E23afCDf3BeFF51796E9', decimals: 18 },
  { symbol: 'PENGU', address: '0xEA7dC9849206Ce73b11c465d37b85eC06B11Cf2C', decimals: 18 },
  { symbol: 'OSWALD', address: '0xB588418c0f90F07Bc9587d0050845a90C23C7502', decimals: 18 },
  { symbol: 'KICK', address: '0x512Ee6Bd7A4be5Ba4796F15Df080c4D0F89a38eD', decimals: 18 },
  { symbol: 'FERB', address: '0x145e03A80c19ad1b9d0429d06b6d52707de724A0', decimals: 18 },
];

const RECLAIM_HEIGHT_OFFSET = 1000;

interface Props {
  midenAccountId: string | null;
  midenAssets: Array<{
    assetId: string;
    amount: bigint;
    symbol?: string;
    decimals?: number;
  }>;
  isLoadingMidenAssets: boolean;
  onFetchQuote: (params: CrossChainIntentParams) => Promise<void>;
  onConfirmIntent: (createMidenP2IDNote: SolveIntentParams['createMidenP2IDNote']) => Promise<unknown>;
  onClearQuote: () => void;
  pendingQuote: CrossChainQuote | null;
  isFetchingQuote: boolean;
  isConfirmBusy: boolean;
  isSDKReady: boolean;
  intentNonce?: string;
  intentUserAddress?: string;
}

export function IntentForm({
  midenAccountId,
  midenAssets,
  isLoadingMidenAssets,
  onFetchQuote,
  onConfirmIntent,
  onClearQuote,
  pendingQuote,
  isFetchingQuote,
  isConfirmBusy,
  isSDKReady,
  intentNonce,
  intentUserAddress,
}: Props) {
  const { requestSend, waitForTransaction } = useMidenFiWallet();
  const { syncHeight } = useSyncState();

  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [minTokenOut, setMinTokenOut] = useState('1000000000000000000');
  const [outputToken, setOutputToken] = useState(SEPOLIA_TOKENS[0].address);
  const [chainId, setChainId] = useState(DEFAULT_SEPOLIA_CHAIN_ID_STR);
  const [confirmStatus, setConfirmStatus] = useState('');
  const [localIntentNonce, setLocalIntentNonce] = useState<string | undefined>(undefined);
  const [localIntentUserAddress, setLocalIntentUserAddress] = useState<string | undefined>(undefined);
  const [localMidenNoteId, setLocalMidenNoteId] = useState<string | undefined>(undefined);
  const destinationChainIdNum = Number.parseInt(chainId, 10);
  const hasValidDestinationChainId = Number.isInteger(destinationChainIdNum) && destinationChainIdNum > 0;
  const { address } = useAccount();
  const [evmAddress, setEvmAddress] = useState(address ?? '');

  const effectiveIntentNonce = localIntentNonce ?? intentNonce;
  const effectiveIntentUserAddress = localIntentUserAddress ?? intentUserAddress;
  const { statuses: txStatuses, isPolling: isTxStatusPolling } = useIntentTransactionStatus(
    effectiveIntentUserAddress,
    effectiveIntentNonce,
  );

  const latestStatus = txStatuses[txStatuses.length - 1];
  const latestStatusLabel = latestStatus?.status ? String(latestStatus.status) : undefined;

  // Filter out the synthetic Miden settlement row that SIO surfaces under the
  // pseudo chainId. Miden→EVM only cares about the EVM execution row.
  const MIDEN_CHAIN_ID = 999_999_999;
  const evmStatuses = txStatuses.filter((s) => Number(s.chainId) !== MIDEN_CHAIN_ID);

  // Only show the EVM tx hash once the polling API reports a terminal success.
  // PENDING / FAILED rows do not display a hash to the user.
  const TERMINAL_OK = new Set(['success', 'completed']);
  const evmCompletedStatus = evmStatuses.find(
    (s) =>
      TERMINAL_OK.has(String(s.status).toLowerCase()) &&
      typeof s.transactionHash === 'string' &&
      s.transactionHash.length > 0,
  );
  const evmTransactionHash = evmCompletedStatus?.transactionHash;

  const evmTxChainId = evmCompletedStatus?.chainId ?? destinationChainIdNum;

  const midenScanBase =
    (import.meta as any).env?.VITE_MIDENSCAN_URL || 'https://testnet.midenscan.com';
  const midenNoteUrl = localMidenNoteId
    ? `${midenScanBase}/note/${localMidenNoteId}`
    : undefined;

  const explorerTxUrl = (() => {
    if (!evmTransactionHash) return undefined;
    const id = Number(evmTxChainId);
    const base: Record<number, string> = {
      1: 'https://etherscan.io',
      11155111: 'https://sepolia.etherscan.io',
      8453: 'https://basescan.org',
      84532: 'https://sepolia.basescan.org',
      10: 'https://optimistic.etherscan.io',
      11155420: 'https://sepolia-optimism.etherscan.io',
      42161: 'https://arbiscan.io',
      421614: 'https://sepolia.arbiscan.io',
      137: 'https://polygonscan.com',
      80002: 'https://amoy.polygonscan.com',
    };
    const root = base[id];
    return root ? `${root}/tx/${evmTransactionHash}` : undefined;
  })();

  const hasValidEvmRecipient = /^0x[a-fA-F0-9]{40}$/.test(evmAddress?.trim() ?? '');

  const selectedAsset = midenAssets.find(
    (a) => a.assetId.toLowerCase() === selectedAssetId.toLowerCase(),
  );
  const midenFaucetDecimals = selectedAsset?.decimals ?? 8;

  const buildParams = (): CrossChainIntentParams => {
    if (!evmAddress) {
      throw new Error('Connect EVM wallet first');
    }
    if (!hasValidDestinationChainId) {
      throw new Error('Destination chain ID must be a positive integer.');
    }
    if (!hasValidEvmRecipient) {
      throw new Error('Destination EVM address must be a valid 0x-prefixed 20-byte hex address.');
    }
    if (!midenAccountId) {
      throw new Error('Connect Miden wallet first');
    }
    if (!Number.isFinite(syncHeight) || syncHeight <= 0) {
      throw new Error(
        'Miden chain tip is unknown — wait for the first sync to complete before quoting.',
      );
    }
    // Reclaim height is *current chain tip + N*, computed at the call site so
    // the user can recall the P2IDE note after the intent expires. A literal
    // default like '1000' would treat the value as an absolute block number
    // and the note would be reclaimable immediately on a synced chain — see
    // pitfall §1.7 row 4.
    const midenReclaimHeight = syncHeight + RECLAIM_HEIGHT_OFFSET;
    return {
      midenAccountId,
      midenFaucetId: selectedAssetId,
      midenDecimals: midenFaucetDecimals,
      midenReclaimHeight,
      evmRecipient: evmAddress.trim(),
      destinationChainId: destinationChainIdNum,
      outputTokenAddress: outputToken,
      minTokenOut,
    };
  };

  const canFetch =
    isSDKReady &&
    !!midenAccountId &&
    !!selectedAssetId &&
    hasValidEvmRecipient &&
    !!outputToken &&
    hasValidDestinationChainId &&
    Number.isFinite(midenFaucetDecimals) &&
    Number.isFinite(syncHeight) &&
    syncHeight > 0;

  const handleGetQuote = () => {
    if (!outputToken || outputToken === '0x0000000000000000000000000000000000000000') {
      toast.error('Select or enter a valid output token address');
      return;
    }
    void toast.promise(onFetchQuote(buildParams()), {
      loading: 'Fetching quote…',
      success: 'Quote ready — review and confirm',
      error: (err) => (err instanceof Error ? err.message : 'Quote failed'),
    });
  };

  const handleConfirm = () => {
    if (!pendingQuote) return;

    const createMidenP2IDNote: SolveIntentParams['createMidenP2IDNote'] = async (
      faucetIdParam,
      amountParam,
      allocatorId,
    ) => {
      setConfirmStatus('Resource lock required — creating P2IDE note on Miden…');
      try {
        if (!midenAccountId) {
          throw new Error('Missing Miden account id');
        }
        if (!requestSend) {
          throw new Error('Miden wallet adapter is not connected');
        }

        const normalizedAmount = BigInt(amountParam);
        if (normalizedAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Amount too large for wallet adapter send');
        }

        const payload = new SendTransaction(
          midenAccountId,
          allocatorId,
          faucetIdParam,
          'public',
          Number(normalizedAmount),
        );
        const txId = await requestSend(payload);

        // Prefer adapter waitForTransaction to get the output note id.
        if (!waitForTransaction) {
          throw new Error('Miden wallet adapter is missing waitForTransaction');
        }
        const finalized = await waitForTransaction(txId, 120_000);
        const first = finalized.outputNotes?.[0];
        const noteId = first ? first.id().toString() : '';
        if (!noteId) {
          throw new Error(`Could not read output note id for tx ${txId}`);
        }
        setLocalMidenNoteId(noteId);
        return { success: true, noteId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    void toast.promise(
      (async () => {
        setConfirmStatus('Submitting intent…');
        const result = await onConfirmIntent(createMidenP2IDNote);
        if (result && typeof result === 'object' && 'error' in result && (result as { error?: string }).error) {
          throw new Error((result as { error: string }).error);
        }
        if (result && typeof result === 'object') {
          console.log('result', result);
          const r = result as any;
          const isNonceLike = (v: unknown) =>
            typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint';
          const rawNonce = isNonceLike(r.nonce)
            ? r.nonce
            : isNonceLike(r.intentNonce)
              ? r.intentNonce
              : isNonceLike(r.solveResult?.nonce)
                ? r.solveResult.nonce
                : isNonceLike(r.solveResult?.submittedIntentData?.nonce)
                  ? r.solveResult.submittedIntentData.nonce
                  : isNonceLike(r.submittedIntentData?.nonce)
                    ? r.submittedIntentData.nonce
                    : undefined;
          const nonce = rawNonce != null ? String(rawNonce) : undefined;
          console.log('[IntentForm] extracted nonce', {
            nonce,
            raw: r.nonce,
            alt: r.intentNonce,
            solveNonce: r.solveResult?.nonce,
            submittedNonce: r.solveResult?.submittedIntentData?.nonce,
          });
          const recipient =
            'intentData' in result &&
            (result as any).intentData &&
            typeof (result as any).intentData === 'object' &&
            typeof (result as any).intentData.recipient === 'string'
              ? ((result as any).intentData.recipient as string)
              : undefined;

          if (nonce) setLocalIntentNonce(nonce);
          // Prefer intentData.recipient, but fall back to what the user entered in the form.
          setLocalIntentUserAddress((recipient ?? evmAddress)?.trim() || undefined);
        }
        setConfirmStatus('Intent submitted successfully.');
        return 'Cross-chain intent submitted';
      })(),
      {
        loading: 'Confirming intent…',
        success: (msg) => msg,
        error: (err) => {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setConfirmStatus(`Error: ${msg}. Quote is still saved — try again.`);
          return `Error: ${msg}`;
        },
      },
    );
  };

  return (
    <div className="ui-card">
      <h2 className="text-base font-semibold text-neutral-900">Intent details</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        Pick a Miden token and the EVM output you want to receive. Set a minimum output amount, then click{' '}
        <strong>Get quote</strong> to see the estimated Miden spend, and <strong>Confirm &amp; sign</strong> to lock
        funds and submit.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label>Source asset</Label>
          <SelectRoot
            value={selectedAssetId || undefined}
            onValueChange={(v) => {
              setSelectedAssetId(v);
              onClearQuote();
            }}
          >
            <SelectTrigger aria-label="Select Miden asset">
              <SelectValue placeholder={isLoadingMidenAssets ? 'Loading assets…' : 'Select asset'} />
            </SelectTrigger>
            <SelectContent>
              {(midenAssets ?? []).map((a) => (
                <SelectItem key={a.assetId} value={a.assetId}>
                  {(a.symbol ?? a.assetId.slice(0, 16) + '…')} — {formatMidenAssetAmount(a.amount, a.decimals)}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
          <p className="text-xs text-neutral-500">
            Balance: <span className="font-mono">{selectedAsset ? formatMidenAssetAmount(selectedAsset.amount, selectedAsset.decimals) : '—'}</span>
          </p>
        </div>

        {/* Output */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Output token ({chainId === DEFAULT_SEPOLIA_CHAIN_ID_STR ? 'Sepolia' : 'destination chain'})</Label>
            <SelectRoot
              value={outputToken}
              onValueChange={(v) => {
                setOutputToken(v);
                onClearQuote();
              }}
            >
              <SelectTrigger aria-label="Select output token">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {SEPOLIA_TOKENS.map((token) => (
                  <SelectItem key={token.symbol} value={token.address}>
                    {token.symbol}{token.address ? ` · ${token.address.slice(0, 10)}…` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
          <div>
            <Label htmlFor="intent-min-out">Min output amount</Label>
            <Input
              id="intent-min-out"
              value={minTokenOut}
              onChange={(e) => { setMinTokenOut(e.target.value); onClearQuote(); }}
              placeholder="e.g. 10"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="intent-chain">Destination chain ID</Label>
            <Input
              id="intent-chain"
              value={chainId}
              onChange={(e) => {
                setChainId(e.target.value);
                onClearQuote();
              }}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="intent-evm">Destination (EVM wallet)</Label>
          <Input
            id="intent-evm"
            value={evmAddress ?? '' }
            onChange={(e) => {
              onClearQuote();
              setEvmAddress(e.target.value);
            }}
            variant="dim"
            className="font-mono text-[13px]"
            placeholder="0x…"
          />
        </div>

        {/* Quote summary — shown after successful fetchQuote */}
        {pendingQuote && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-900">Quote</span>
              <button
                type="button"
                className="text-xs text-neutral-500 underline"
                onClick={onClearQuote}
              >
                Re-quote
              </button>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-700">Required deposit</p>
              <p className="mt-1 font-mono text-xl font-semibold text-orange-900">
                {(() => {
                  const quoteDecimalsRaw = (pendingQuote.quoteResult as any).midenFaucetDecimals;
                  const quoteDecimals =
                    typeof quoteDecimalsRaw === 'number'
                      ? quoteDecimalsRaw
                      : typeof quoteDecimalsRaw === 'string'
                        ? Number(quoteDecimalsRaw)
                        : undefined;
                  const resolvedDisplayDecimals =
                    Number.isFinite(quoteDecimals) && (quoteDecimals as number) >= 0
                      ? (quoteDecimals as number)
                      : midenFaucetDecimals;
                  const tokenInRaw = (pendingQuote.quoteResult as any).tokenIn as
                    | string
                    | undefined;
                  if (!tokenInRaw) return 'calculated at execution';
                  return `${formatQuoteTokenIn(
                    tokenInRaw,
                    resolvedDisplayDecimals,
                    resolvedDisplayDecimals,
                  )} ${selectedAsset?.symbol ?? 'tokens'}`;
                })()}
              </p>
            </div>
            <p className="text-xs text-neutral-500 italic">Keep at least this amount in your Miden wallet before confirming.</p>
          </div>
        )}

        {/* Action buttons */}
        {!pendingQuote ? (
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleGetQuote}
            disabled={isFetchingQuote || !canFetch}
          >
            {isFetchingQuote ? 'Fetching quote…' : 'Get quote'}
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={isConfirmBusy}
          >
            {isConfirmBusy ? 'Processing…' : 'Confirm & Sign'}
          </Button>
        )}

        {!isSDKReady && (
          <p className="text-xs text-amber-800">
            Epoch SDK not ready — connect your EVM wallet above.
          </p>
        )}

        {confirmStatus && (
          <p className={`text-sm ${confirmStatus.startsWith('Error') ? 'text-red-600' : 'text-amber-800'}`}>
            {confirmStatus}
          </p>
        )}

        {localMidenNoteId && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Miden note id (P2IDE)</div>
              {midenNoteUrl && (
                <a
                  href={midenNoteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[11px] font-medium text-neutral-600 underline hover:text-neutral-900"
                >
                  View on Midenscan ↗
                </a>
              )}
            </div>
            {midenNoteUrl ? (
              <a
                href={midenNoteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 block font-mono text-[12px] text-neutral-700 break-all underline decoration-neutral-300 hover:decoration-neutral-700"
              >
                {localMidenNoteId}
              </a>
            ) : (
              <div className="mt-0.5 font-mono text-[12px] text-neutral-700 break-all">{localMidenNoteId}</div>
            )}
          </div>
        )}

        {isTxStatusPolling && !evmTransactionHash && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              <svg
                className="h-5 w-5 animate-spin text-amber-700"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  Waiting for EVM execution
                </div>
                <div className="mt-0.5 text-[12px] text-amber-900">
                  {latestStatusLabel
                    ? `Status: ${latestStatusLabel} · polling every 5s…`
                    : 'Solver picking up intent · polling every 5s…'}
                </div>
              </div>
            </div>
          </div>
        )}

        {!!evmTransactionHash && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                EVM execution tx hash
              </div>
              {explorerTxUrl && (
                <a
                  href={explorerTxUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[11px] font-medium text-emerald-700 underline hover:text-emerald-900"
                >
                  View on explorer ↗
                </a>
              )}
            </div>
            {explorerTxUrl ? (
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 block font-mono text-[12px] text-emerald-900 break-all underline decoration-emerald-300 hover:decoration-emerald-700"
              >
                {evmTransactionHash}
              </a>
            ) : (
              <div className="mt-0.5 font-mono text-[12px] text-emerald-900 break-all">
                {evmTransactionHash}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
