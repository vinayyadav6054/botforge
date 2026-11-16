import Link from "next/link";

/** Brand mark: a speech bubble with a spark (an instant answer), in the brand gradient, plus the word mark "Kahiye". */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="mark">
      <defs>
        <linearGradient id="bf-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f766e" />
          <stop offset=".6" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="26" rx="9" fill="url(#bf-mark)" />
      <path d="M9 27 L9 31 L14 27 Z" fill="#0f766e" />
      <path d="M17.5 6.5 L12 15.5 h4.2 L14.5 21.5 L20.5 12 h-4.3 Z" fill="#ffffff" />
    </svg>
  );
}

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Kahiye home">
      <Mark />
      <span>Kah<em>iye</em></span>
    </Link>
  );
}
