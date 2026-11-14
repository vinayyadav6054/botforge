import Link from "next/link";
import DemoWidget from "@/components/landing/DemoWidget";
import { site } from "@/lib/site";

export const metadata = {
  title: "Demo website · Kahiye",
  description: "A sample coaching institute website with a Kahiye assistant in the corner.",
};

const COLOR = "#1d4ed8";

const COURSES = [
  { name: "JEE Main + Advanced", years: "2-year programme", fee: "₹68,000 / year" },
  { name: "NEET", years: "2-year programme", fee: "₹62,000 / year" },
  { name: "Foundation (Class 8–10)", years: "1-year programme", fee: "₹38,000 / year" },
];

/** A made-up client website, so prospects see the assistant exactly as their own visitors would. */
export default function DemoSite() {
  return (
    <div className="demo-site" style={{ ["--site" as string]: COLOR }}>
      <div className="demo-banner">
        <span>
          <strong>Demo:</strong> a sample website for a made-up institute.{" "}
          {site.demoBotKey ? "The assistant in the corner is a real Kahiye bot." : "Open the chat in the corner."}
        </span>
        <Link href="/">← Back to Kahiye</Link>
      </div>

      <header className="ds-nav">
        <div className="ds-wrap ds-nav-inner">
          <div className="ds-logo"><span>☀</span> Sunrise Academy</div>
          <nav className="ds-links" aria-label="Demo site">
            <span>Courses</span><span>Results</span><span>Admissions</span><span>Contact</span>
          </nav>
        </div>
      </header>

      <section className="ds-hero">
        <div className="ds-wrap">
          <p className="ds-kicker">Admissions open · Batch starts 5 January</p>
          <h1>Crack JEE &amp; NEET with Pune&apos;s most trusted faculty.</h1>
          <p>Small batches of 30, weekly tests, and doubt-solving every evening.</p>
          <div className="ds-cta">
            <span className="ds-btn">Book a free demo class</span>
            <span className="ds-btn outline">Download brochure</span>
          </div>
        </div>
      </section>

      <section className="ds-wrap ds-section">
        <h2>Our courses</h2>
        <div className="ds-grid">
          {COURSES.map((c) => (
            <div key={c.name} className="ds-card">
              <h3>{c.name}</h3>
              <p>{c.years}</p>
              <strong>{c.fee}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="ds-wrap ds-section ds-stats">
        <div><strong>1,200+</strong><span>students selected</span></div>
        <div><strong>15</strong><span>years of teaching</span></div>
        <div><strong>4.8★</strong><span>Google rating</span></div>
      </section>

      <section className="ds-wrap ds-section ds-hint">
        <h2>Try asking the assistant 👉</h2>
        <ul>
          <li>“What is the fee for the JEE batch?”</li>
          <li>“When does the next batch start?”</li>
          <li>“Is there a free demo class?”</li>
          <li>“Kya scholarship milti hai?”</li>
        </ul>
      </section>

      <footer className="ds-foot">
        <div className="ds-wrap">Sunrise Academy · FC Road, Pune · This is a fictional business for demonstration.</div>
      </footer>

      <DemoWidget botKey={site.demoBotKey} color={COLOR} />
    </div>
  );
}
