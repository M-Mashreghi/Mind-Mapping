/** App mark: a claim supported by two premises. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="3" width="14" height="8" rx="2.5" fill="var(--brand)" />
      <rect x="2.5" y="21" width="12" height="8" rx="2.5" fill="var(--reason)" />
      <rect x="17.5" y="21" width="12" height="8" rx="2.5" fill="var(--objection)" />
      <path d="M8.5 21V16h15v5M16 16v-5" fill="none" stroke="var(--ink-2)" strokeWidth="1.8" />
    </svg>
  );
}
