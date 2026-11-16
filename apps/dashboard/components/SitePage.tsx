import Footer from "@/components/landing/Footer";
import SiteAssistant from "@/components/landing/SiteAssistant";
import NavBar from "@/components/landing/NavBar";
import "@/components/landing/landing.css";

/** Layout of public pages other than the home page: the same navbar and footer, a calm reading column. */
export default function SitePage({ eyebrow, title, intro, children, wide = false }: {
  eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="lp">
      <SiteAssistant />
      <NavBar home={false} />
      <main className="sp">
        <header className="sp-head">
          <div className="lp-wrap">
            {eyebrow && <p className="lp-eyebrow">{eyebrow}</p>}
            <h1 className="lp-h2">{title}</h1>
            {intro && <div className="sp-intro">{intro}</div>}
          </div>
        </header>
        <div className={`lp-wrap sp-body${wide ? " wide" : ""}`}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}
