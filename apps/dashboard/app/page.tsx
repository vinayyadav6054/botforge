import Link from "next/link";
import ChatDemo from "@/components/landing/ChatDemo";
import NavCta from "@/components/landing/NavCta";
import Logo from "@/components/Logo";
import { site, whatsappLink } from "@/lib/site";

export const metadata = {
  title: "BotForge · An AI receptionist for your website",
  description:
    "Upload your brochure, price list and FAQs. BotForge answers your website visitors 24×7 from your own documents and collects their phone numbers for you.",
};

const STEPS = [
  {
    title: "Upload what you already have",
    text: "Brochures, fee lists, menus, FAQs. PDF, Word or text. BotForge reads them in about a minute.",
  },
  {
    title: "Make it yours",
    text: "Name your assistant, write a welcome line, add one-tap questions and switch on call-back requests.",
  },
  {
    title: "Paste one line on your site",
    text: "Works on WordPress, Wix, Shopify or plain HTML. The chat bubble appears instantly, on every page.",
  },
];

const FEATURES = [
  { icon: "📄", title: "Answers only from your documents", text: "No made-up prices or promises. If it isn't in your files, the bot says so and points the visitor to you." },
  { icon: "📞", title: "Turns visitors into leads", text: "Visitors leave their name and number in the chat. You get the whole conversation with it." },
  { icon: "💬", title: "WhatsApp in one tap", text: "Open any lead straight in WhatsApp or call them from your phone. Mark them contacted or converted." },
  { icon: "⚡", title: "Instant, streaming replies", text: "Answers stream in within seconds, at 2 PM or 2 AM, on mobile and desktop." },
  { icon: "🎯", title: "Suggested questions", text: "Show the questions customers ask most as buttons, so visitors get answers with one tap." },
  { icon: "🔒", title: "Your data stays yours", text: "Every business gets its own private workspace. Export your leads to Excel any time." },
];

const INDUSTRIES = ["Coaching institutes", "Dental & medical clinics", "Real estate", "Restaurants & cafés", "Salons & spas", "Travel agents", "Schools", "Gyms", "Online shops"];

const FAQ = [
  {
    q: "Do I need a developer?",
    a: "No. You upload files in the dashboard and copy one line into your website. If your site is on WordPress or Wix, it is a paste into the footer settings. We can also do it for you.",
  },
  {
    q: "What if the bot doesn't know an answer?",
    a: "It only answers from the documents you upload. When something isn't covered it says so honestly, and the call-back button lets the visitor leave their number, so you still get the lead.",
  },
  {
    q: "Which languages does it understand?",
    a: "Visitors can ask in English, Hindi, Hinglish and many other languages, and the bot replies in the language they used. Your documents can stay in English.",
  },
  {
    q: "How do I update prices or timings?",
    a: "Upload the new file and delete the old one. The bot uses the new information within a minute.",
  },
  {
    q: "Is my customers' data safe?",
    a: "Each business has its own isolated workspace, connections are encrypted, and you can delete any enquiry or export everything whenever you like.",
  },
];

export default function Landing() {
  const year = new Date().getFullYear();
  return (
    <div className="landing">
      <header className="lnav">
        <div className="lwrap lnav-inner">
          <Logo />
          <nav className="lnav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#demo">Demo</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lnav-cta">
            <NavCta />
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="lwrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">For coaching classes, clinics, builders, restaurants…</p>
              <h1 className="display">
                Your website&apos;s <em>receptionist</em>, awake at 2&nbsp;AM.
              </h1>
              <p className="lead-text">
                Upload your brochure, price list and FAQs. BotForge answers every visitor instantly from{" "}
                <strong>your own documents</strong> and hands you their phone number when they&apos;re ready to talk.
              </p>
              <div className="hero-cta">
                <Link href="/register" className="btn lg">Build your bot free</Link>
                <a href="#demo" className="btn ghost lg">See it answer ↓</a>
              </div>
              <ul className="hero-proof">
                <li>Live in 10 minutes</li>
                <li>No coding</li>
                <li>{site.trialNote.split(".")[0]}</li>
              </ul>
            </div>

            <div className="hero-art" aria-hidden>
              <div className="float-card card-chat">
                <div className="fc-head"><span className="avatar">S</span><strong>Sunrise Assistant</strong></div>
                <div className="bubble user">Is there a free demo class?</div>
                <div className="bubble bot">
                  Yes! Every Sunday at 11 AM. Share your number and the counsellor will reserve a seat.
                  <span className="bubble-src">Admission_FAQ.txt</span>
                </div>
              </div>
              <div className="float-card card-lead">
                <span className="ping" />
                <div>
                  <div className="small muted">New lead · 11:42 PM</div>
                  <strong>Rohan M. · +91 98XXX XX214</strong>
                </div>
              </div>
              <div className="float-card card-code">
                <code>
                  <span className="tok-tag">&lt;script</span> <span className="tok-attr">src</span>=
                  <span className="tok-str">&quot;…/widget.js&quot;</span>
                  <span className="tok-tag">&gt;</span>
                </code>
                <span className="small">One line. Any website.</span>
              </div>
              <div className="ember e1" />
              <div className="ember e2" />
            </div>
          </div>
        </section>

        <section className="strip" aria-label="Who it is for">
          <div className="marquee">
            <div className="marquee-track">
              {[...INDUSTRIES, ...INDUSTRIES].map((x, i) => (
                <span key={i}>{x}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className="lsection">
          <div className="lwrap">
            <div className="section-head">
              <p className="eyebrow">Live demo</p>
              <h2 className="display-2">Watch a visitor become a lead.</h2>
              <p className="muted">
                Pick a business. The bot reads its documents, answers, and the enquiry lands in the owner&apos;s inbox.
                Tap a question or type your own.
              </p>
            </div>
            <ChatDemo />
            <p className="center" style={{ marginTop: 20 }}>
              <Link href="/demo" className="link-arrow">Open the full demo website →</Link>
            </p>
          </div>
        </section>

        <section id="how" className="lsection alt">
          <div className="lwrap">
            <div className="section-head">
              <p className="eyebrow">How it works</p>
              <h2 className="display-2">From PDF to live assistant in three steps.</h2>
            </div>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="step">
                  <span className="step-num">0{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p className="muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lsection">
          <div className="lwrap">
            <div className="section-head">
              <p className="eyebrow">Why owners keep it</p>
              <h2 className="display-2">Less repeating yourself. More enquiries.</h2>
            </div>
            <div className="features">
              {FEATURES.map((f) => (
                <div key={f.title} className="feature">
                  <span className="feature-icon" aria-hidden>{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p className="muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="lsection alt">
          <div className="lwrap">
            <div className="section-head">
              <p className="eyebrow">Pricing</p>
              <h2 className="display-2">Less than one missed admission.</h2>
              <p className="muted">{site.trialNote}</p>
            </div>
            <div className="plans">
              {site.plans.map((p) => (
                <div key={p.name} className={`plan${p.featured ? " featured" : ""}`}>
                  {p.featured && <span className="plan-flag">Most popular</span>}
                  <h3>{p.name}</h3>
                  <p className="muted small">{p.blurb}</p>
                  <div className="price">
                    <span className="cur">{site.currency}</span>
                    {p.price}
                    <span className="per">/month</span>
                  </div>
                  <ul>
                    {p.features.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  <Link href="/register" className={`btn block${p.featured ? "" : " secondary"}`}>Start free trial</Link>
                </div>
              ))}
            </div>
            {site.whatsapp && (
              <p className="center muted" style={{ marginTop: 22 }}>
                Want us to set it up for you?{" "}
                <a href={whatsappLink("Hi! I'd like a BotForge assistant for my website.")} target="_blank" rel="noopener noreferrer">
                  Chat with us on WhatsApp
                </a>
              </p>
            )}
          </div>
        </section>

        <section id="faq" className="lsection">
          <div className="lwrap narrow">
            <div className="section-head">
              <p className="eyebrow">FAQ</p>
              <h2 className="display-2">Questions owners ask us.</h2>
            </div>
            <div className="faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p className="muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="lwrap center">
            <h2 className="display-2">Your next customer is on your website right now.</h2>
            <p>Give them an answer before they leave.</p>
            <div className="hero-cta center-row">
              <Link href="/register" className="btn lg">Build your bot free</Link>
              {site.whatsapp && (
                <a href={whatsappLink("Hi! I'd like to know more about BotForge.")} className="btn ghost-light lg"
                  target="_blank" rel="noopener noreferrer">
                  Talk on WhatsApp
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lfoot">
        <div className="lwrap lfoot-inner">
          <Logo />
          <span className="muted small">
            © {year} {site.name}
            {site.email && <> · <a href={`mailto:${site.email}`}>{site.email}</a></>}
          </span>
          <nav className="small" aria-label="Footer">
            <Link href="/demo">Demo</Link>
            <Link href="/login">Log in</Link>
            <Link href="/register">Sign up</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
