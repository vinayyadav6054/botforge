import Link from "next/link";
import Logo from "@/components/Logo";
import { site } from "@/lib/site";

export const UPDATED = "13 November 2026";

export function contact() {
  return site.email ? <a href={`mailto:${site.email}`}>{site.email}</a> : <>the contact details on our website</>;
}

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="landing">
      <header className="lnav">
        <div className="lwrap lnav-inner">
          <Logo />
          <div className="lnav-cta">
            <Link href="/privacy" className="nav-login">Privacy</Link>
            <Link href="/terms" className="nav-login">Terms</Link>
          </div>
        </div>
      </header>
      <main className="legal">
        <h1>{title}</h1>
        <p className="muted">Last updated: {UPDATED}</p>
        {children}
      </main>
    </div>
  );
}
