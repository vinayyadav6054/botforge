import Link from "next/link";

/** Brand mark: a speech bubble with a spark (the "forge"), plus the word mark. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="mark">
      <rect x="1" y="1" width="30" height="26" rx="9" fill="var(--accent)" />
      <path d="M9 27 L9 31 L14 27 Z" fill="var(--accent)" />
      <path d="M17.5 6.5 L12 15.5 h4.2 L14.5 21.5 L20.5 12 h-4.3 Z" fill="var(--on-accent)" />
    </svg>
  );
}

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="BotForge home">
      <Mark />
      <span>Bot<em>Forge</em></span>
    </Link>
  );
}
