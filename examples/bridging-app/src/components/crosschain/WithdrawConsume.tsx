import { midenscanNoteUrl, truncateHash } from '../../lib/explorers';

interface Props {
  /** Miden Note ID surfaced by the Withdraw flow (allocator-created P2ID). */
  noteId?: string;
  /** Hex Miden account ID that receives the note. Kept on the prop interface so
   *  the call site mirrors the withdraw result data. */
  midenAccountId?: string;
}

/**
 * Post-withdraw informational panel.
 *
 * The Epoch allocator delivers bridged funds as a P2ID note addressed to the
 * user's Miden wallet account. The Miden Wallet consumes that note when it
 * detects it, so this panel reports delivery and links to Midenscan instead of
 * initiating a second transaction from the page.
 */
export function WithdrawConsume({ noteId }: Props) {
  if (!noteId) return null;
  const noteUrl = midenscanNoteUrl(noteId);
  return (
    <div className="ui-card space-y-3">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">Note delivered to your Miden wallet</h2>
        <p className="mt-1 text-sm leading-relaxed text-neutral-600">
          The allocator delivered the bridged funds as a <strong>P2ID note</strong> to your Miden
          wallet account. In Miden's actor model the note must be{' '}
          <em>consumed</em> before it becomes spendable balance — but the Miden Wallet auto-consumes
          incoming notes on detection, so no action is required here. Open your wallet to confirm
          the new balance; the bridged USDC is ready to use as the source for another
          Miden&nbsp;→&nbsp;EVM bridge or any other Miden transaction.
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
          Target note (delivered → wallet)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[12px] text-emerald-900">
            {truncateHash(noteId)}
          </span>
          <a
            href={noteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-emerald-700/30 px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-white/40 transition-colors whitespace-nowrap"
          >
            View on Midenscan ↗
          </a>
        </div>
      </div>

      <p className="text-[11px] text-neutral-500 italic">
        If your wallet does not show the credited balance, the note may still be propagating
        through testnet — refresh the wallet after a few seconds. Some wallet builds let you
        disable auto-consume; in that case, consume the note manually from the wallet's Notes tab.
      </p>
    </div>
  );
}
