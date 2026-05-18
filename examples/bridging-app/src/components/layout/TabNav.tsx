interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  disabledTabs?: Partial<Record<string, string>>;
}

const tabs = [
  { id: 'crosschain', label: 'Cross-chain bridge' },
  { id: 'withdraw', label: 'Withdraw to Miden' },
];

export function TabNav({ activeTab, onTabChange, disabledTabs }: Props) {
  return (
    <nav
      className="flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100/90 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap"
      aria-label="Primary navigation"
    >
      {tabs.map((tab) => (
        (() => {
          const disabledReason = disabledTabs?.[tab.id];
          const isDisabled = !!disabledReason;
          const isActive = activeTab === tab.id;
          return (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            if (!isDisabled) onTabChange(tab.id);
          }}
          disabled={isDisabled}
          title={disabledReason}
          className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out ${
            isActive
              ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/80'
              : isDisabled
                ? 'cursor-not-allowed text-neutral-400 opacity-60'
                : 'text-neutral-600 hover:bg-white/70 hover:text-neutral-900'
          }`}
        >
          {tab.label}
        </button>
          );
        })()
      ))}
    </nav>
  );
}
