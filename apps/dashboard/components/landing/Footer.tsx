import Link from "next/link";
import Logo from "@/components/Logo";
import { site } from "@/lib/site";

/** The footer of every public page. */
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="lp-foot">
    <div className="lp-wrap">
      <div className="lp-foot-grid">
        <div className="lp-foot-brand">
          <Logo />
          <p>The AI receptionist for India&apos;s local businesses: answers every customer from your own information and sends you every lead.</p>
        </div>
        <div>
          <h4>Product</h4>
          <nav aria-label="Product">
            <a href="/#features">Features</a><a href="/#demo">Live demo</a><Link href="/demo">Demo website</Link><a href="/#pricing">Pricing</a>
          </nav>
        </div>
        <div>
          <h4>Support</h4>
          <nav aria-label="Support">
            <Link href="/help">Help centre</Link><Link href="/help#contact">Contact us</Link><Link href="/login">Log in</Link><Link href="/register">Create account</Link>
          </nav>
        </div>
        <div>
          <h4>Legal</h4>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of service</Link><Link href="/privacy#cookies">Cookies</Link>
          </nav>
        </div>
      </div>
      <div className="lp-foot-bottom">
        <span>© {year} {site.name}. Made in India.</span>
        {site.email && <a href={`mailto:${site.email}`}>{site.email}</a>}
      </div>
    </div>
  </footer>
  );
}
