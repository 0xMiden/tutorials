import type { IntentResult } from '../../types/miden';
import {
  explorerTxUrl,
  midenscanNoteUrl,
  truncateHash,
} from '../../lib/explorers';

export interface IntentFlowStatus {
  evmCompleted: boolean;
  evmTransactionHash?: string;
  evmChainId?: number;
  midenTxId?: string;
  midenStatus?: string;
  midenNoteId?: string;
  latestStatusLabel?: string;
  latestChainId?: string;
  statusCount?: number;
}

interface Props {
  result: IntentResult | null;
  error: string | null;
  flowStatus: IntentFlowStatus | null;
  isPolling: boolean;
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function fallbackMidenNoteId(result: IntentResult | null): string | undefined {
  if (!result) return undefined;
  const r = result as any;
  const candidates = [
    r?.midenNoteId,
    r?.solveResult?.midenNoteId,
    r?.solveResult?.compact?.mandate?.midenNoteId,
    r?.solveResult?.submittedIntentData?.compact?.mandate?.midenNoteId,
    r?.intentData?.midenNoteId,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

interface RowProps {
  label: string;
  value?: string;
  hint?: string;
  href?: string | null;
  buttonLabel?: string;
  tone?: 'success' | 'pending' | 'neutral';
}

function StatusRow({ label, value, hint, href, buttonLabel, tone = 'neutral' }: RowProps) {
  if (!value) return null;
  const toneClasses =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'pending'
        ? 'border-amber-200 bg-amber-50'
        : 'border-neutral-200 bg-neutral-50';
  const labelToneClasses =
    tone === 'success'
      ? 'text-emerald-800'
      : tone === 'pending'
        ? 'text-amber-800'
        : 'text-neutral-500';
  const valueToneClasses =
    tone === 'success'
      ? 'text-emerald-900'
      : tone === 'pending'
        ? 'text-amber-900'
        : 'text-neutral-700';

  return (
    <div className={`rounded-lg border ${toneClasses} px-3 py-2 space-y-1`}>
      <div
        className={`text-[11px] font-semibold uppercase tracking-wide ${labelToneClasses}`}
      >
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`break-all font-mono text-[12px] ${valueToneClasses}`}>
          {truncateHash(value)}
        </span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-current/30 px-2 py-0.5 text-[11px] font-medium hover:bg-white/40 transition-colors whitespace-nowrap"
          >
            {buttonLabel ?? 'View ↗'}
          </a>
        )}
      </div>
      {hint && (
        <div className="text-[11px] text-neutral-500">{hint}</div>
      )}
    </div>
  );
}

export function IntentStatus({ result, error, flowStatus, isPolling }: Props) {
  if (error) {
    return (
      <div className="ui-card border-red-200 bg-red-50/80">
        <h2 className="mb-2 text-lg font-semibold text-red-800">Intent Error</h2>
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!result) return null;

  const evmCompleted = flowStatus?.evmCompleted ?? false;
  const midenTxId = flowStatus?.midenTxId;
  const midenNoteId = flowStatus?.midenNoteId ?? fallbackMidenNoteId(result);

  // Client-side Compact deposit tx hash — signed by the user's wallet via the
  // SDK's `depositERC20AndRegister` / `depositNativeAndRegister` call. This is
  // the deposit the user actually performs; the SIO-side claim shows up on the
  // status poll separately under `flowStatus.evmTransactionHash`.
  const depositTxHash = (result as any)?.solveResult?.depositResult?.transactionHash as
    | string
    | undefined;
  const depositChainId =
    (result as any)?.depositChainId ?? flowStatus?.evmChainId;

  const depositTxUrl =
    depositChainId != null && depositTxHash
      ? explorerTxUrl(Number(depositChainId), depositTxHash)
      : null;
  const midenTxUrl = midenTxId ? explorerTxUrl(/* MIDEN_CHAIN_ID */ 999_999_999, midenTxId) : null;
  const noteUrl = midenNoteId ? midenscanNoteUrl(midenNoteId) : null;

  const stillWaiting = isPolling && !evmCompleted && !midenTxId;

  return (
    <div className="ui-card space-y-3">
      {stillWaiting && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Spinner className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-700" />
          <div className="flex-1 text-[12px] text-amber-900">
            <div className="font-semibold text-amber-800">Waiting for SIO execution…</div>
            <div className="mt-0.5">
              {flowStatus?.latestStatusLabel
                ? `Status: ${flowStatus.latestStatusLabel}${
                    flowStatus.latestChainId ? ` · chain ${flowStatus.latestChainId}` : ''
                  } · polling every 5s`
                : 'Solver picking up intent · polling every 5s'}
            </div>
          </div>
        </div>
      )}

      <StatusRow
        label="Compact Deposit Tx"
        value={depositTxHash}
        href={depositTxUrl}
        buttonLabel="View on Explorer ↗"
        tone={depositTxHash ? 'success' : 'neutral'}
        hint={depositChainId != null ? `chain ${depositChainId}` : undefined}
      />

      <StatusRow
        label="Miden Settlement Tx"
        value={midenTxId}
        href={midenTxUrl}
        buttonLabel="View on Midenscan ↗"
        tone={midenTxId ? 'success' : 'neutral'}
      />

      <StatusRow
        label="Miden Note ID"
        value={midenNoteId}
        href={noteUrl}
        buttonLabel="View Note on Midenscan ↗"
        tone="neutral"
      />
    </div>
  );
}
