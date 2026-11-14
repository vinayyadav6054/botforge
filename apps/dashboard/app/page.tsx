import Link from "next/link";
import ChatDemo from "@/components/landing/ChatDemo";
import HeroStage from "@/components/landing/HeroStage";
import { Faq, FadeIn, ScrollSteps, SpotlightGrid, Stagger } from "@/components/landing/Motion";
import NavBar from "@/components/landing/NavBar";
import SmoothScroll from "@/components/landing/SmoothScroll";
import Logo from "@/components/Logo";
import { site, whatsappLink } from "@/lib/site";
import "@/components/landing/landing.css";

export const metadata = {
  title: "BotForge · AI assistant that turns your website visitors into customers",
  description:
    "Upload your brochure, price list and FAQs. BotForge answers your customers 24×7 on your website and WhatsApp, in Hindi or English, from your own documents, and sends you every lead.",
};

const STEPS = [
  { title: "Upload what you already have", text: "Brochure, fee list, menu, FAQ, or just your website address. BotForge reads it in about a minute." },
  { title: "Test it and make it yours", text: "Ask it anything a customer would. Pick your colour and logo, add one-tap questions and switch on call-backs." },
  { title: "Go live on your website and WhatsApp", text: "Paste one line on WordPress, Wix, Shopify or any site, or share your demo link. Leads start arriving in your inbox." },
];

const INDUSTRIES = ["Coaching institutes", "Dental clinics", "Real estate", "Restaurants & cafés", "Salons & spas", "Schools",
  "Gyms & fitness", "Travel agents", "Hospitals", "Online shops", "Interior designers", "Car dealers"];

const FAQ = [
  { q: "Do I need a developer?", a: "No. You upload files in the dashboard and copy one line into your website, or just share your bot's link on Instagram and WhatsApp. We can also set it up for you." },
  { q: "What if the bot doesn't know an answer?", a: "It answers only from the documents you upload. When something isn't covered it says so honestly and offers a call-back, so you still get the lead. You can also take over any chat and reply yourself." },
  { q: "Which languages does it understand?", a: "English, Hindi, Hinglish, Marathi, Tamil, Telugu and more, typed or spoken. It replies in the customer's language, even when your documents are in English." },
  { q: "How do I update prices or timings?", a: "Upload the new file (or let it re-read your website automatically every week). The bot uses the new information within a minute." },
  { q: "Is my customers' data safe?", a: "Each business has its own private workspace. Messaging-app keys are encrypted, every connection uses HTTPS, and you can export or delete your data any time." },
  { q: "Can I cancel any time?", a: "Yes. There is no contract. The 14-day trial needs no card, and you pay month by month by UPI or card after that." },
];

export default function Landing() {
  const year = new Date().getFullYear();
  return (
    <div className="lp">
      <SmoothScroll />
      <NavBar />

      <main>
        {/* ---------- hero ---------- */}
        <section className="lp-hero">
          <div className="lp-grid-bg" aria-hidden />
          <div className="lp-wrap lp-hero-inner">
            <FadeIn y={14}>
              <Link href="#demo" className="lp-pill"><span className="lp-pill-new">New</span> WhatsApp, Hindi &amp; live takeover <span aria-hidden>→</span></Link>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="lp-h1">
                Turn every website visitor into a <span className="lp-grad">customer</span>, even at 2&nbsp;AM.
              </h1>
            </FadeIn>
            <FadeIn delay={0.12}>
              <p className="lp-lead">
                An AI assistant that answers your customers instantly from <strong>your own brochure, fees and FAQs</strong>, on your
                website and WhatsApp, in Hindi or English, and sends you every lead.
              </p>
            </FadeIn>
            <FadeIn delay={0.18} className="lp-cta">
              <Link href="/register" className="btn lg">Start free, no card needed</Link>
              <a href="#demo" className="btn ghost lg">See it answer</a>
            </FadeIn>
            <FadeIn delay={0.24}>
              <ul className="lp-proof">
                <li>Live in 10 minutes</li><li>14-day free trial</li><li>Cancel any time</li><li>Made for India</li>
              </ul>
            </FadeIn>
          </div>
          <div className="lp-wrap"><HeroStage /></div>
        </section>

        {/* ---------- who it is for ---------- */}
        <section className="lp-strip" aria-label="Who it is for">
          <p>Built for local businesses that get the same questions every day</p>
          <div className="lp-marquee"><div className="lp-marquee-track">
            {[...INDUSTRIES, ...INDUSTRIES].map((x, i) => <span key={i}>{x}</span>)}
          </div></div>
        </section>

        {/* ---------- features ---------- */}
        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <FadeIn className="lp-head">
              <p className="lp-eyebrow">Everything a front desk does</p>
              <h2 className="lp-h2">Less repeating yourself. <span className="lp-grad">More enquiries.</span></h2>
              <p>Your assistant answers the questions, collects the numbers and hands over to you when it matters.</p>
            </FadeIn>
            <SpotlightGrid>
              <Stagger className="lp-bento">
                {[
                  <div key="a" className="spot lp-card wide">
                    <h3>Answers only from your documents</h3>
                    <p>No made-up prices or promises. Every answer comes from your files, with the source shown.</p>
                    <div className="lp-viz-doc">
                      <span className="doc">📄 Fee_Structure_2026.pdf</span><span className="arrow">→</span>
                      <span className="ans">“₹68,000 per year, in 3 instalments.” <small>Source: page 2</small></span>
                    </div>
                  </div>,
                  <div key="b" className="spot lp-card">
                    <h3>Every chat becomes a lead</h3>
                    <p>Name and number land in your inbox and email, with the full conversation.</p>
                    <div className="lp-viz-lead"><span className="ping" /> Rohan M. · +91 98••• ••214 <em>11:42 PM</em></div>
                  </div>,
                  <div key="c" className="spot lp-card">
                    <h3>WhatsApp, Instagram &amp; Telegram</h3>
                    <p>The same assistant answers in the apps your customers already use, voice notes included.</p>
                    <div className="lp-viz-apps"><span>WhatsApp</span><span>Instagram</span><span>Messenger</span><span>Telegram</span></div>
                  </div>,
                  <div key="d" className="spot lp-card">
                    <h3>Hindi, Hinglish &amp; voice</h3>
                    <p>Customers type or speak in their language. Your documents can stay in English.</p>
                    <div className="lp-viz-lang"><span>“fees kitni hai?”</span><span>“फीस कितनी है?”</span></div>
                  </div>,
                  <div key="e" className="spot lp-card">
                    <h3>Take over any chat live</h3>
                    <p>See conversations as they happen and reply yourself. The bot steps aside.</p>
                    <div className="lp-viz-live"><span className="live" /> 3 live now <b>Take over</b></div>
                  </div>,
                  <div key="f" className="spot lp-card wide">
                    <h3>Book visits and collect fees in the chat</h3>
                    <p>“Book a free demo” and “Pay by UPI” buttons, right where the customer decides. Leads also flow to Google Sheets or your CRM.</p>
                    <div className="lp-viz-btns"><span>📅 Book a free demo class</span><span>₹ Pay by UPI</span><span>📊 Google Sheets</span></div>
                  </div>,
                ]}
              </Stagger>
            </SpotlightGrid>
          </div>
        </section>

        {/* ---------- live demo ---------- */}
        <section id="demo" className="lp-section">
          <div className="lp-wrap">
            <FadeIn className="lp-head center">
              <p className="lp-eyebrow">Live demo</p>
              <h2 className="lp-h2">Watch a visitor become a lead.</h2>
              <p>Pick a business. The bot reads its documents, answers, and the enquiry lands in the owner&apos;s inbox. Tap a question or type your own.</p>
            </FadeIn>
            <FadeIn className="lp-demo-frame">
              <div className="lp-frame-bar" aria-hidden><i /><i /><i /><span>sunriseacademy.in</span></div>
              <ChatDemo />
            </FadeIn>
            <p className="lp-center-link"><Link href="/demo">Open the full demo website →</Link></p>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section id="how" className="lp-section">
          <div className="lp-wrap lp-how">
            <FadeIn className="lp-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 className="lp-h2">From PDF to live assistant in <span className="lp-grad">10 minutes</span>.</h2>
              <p>No coding, no training, no waiting for a developer.</p>
              <Link href="/register" className="btn" style={{ marginTop: 10 }}>Build yours now</Link>
            </FadeIn>
            <ScrollSteps steps={STEPS} />
          </div>
        </section>

        {/* ---------- trust ---------- */}
        <section id="trust" className="lp-section">
          <div className="lp-wrap">
            <FadeIn className="lp-head center">
              <p className="lp-eyebrow">Trust &amp; security</p>
              <h2 className="lp-h2">Your business, your data, <span className="lp-grad">your control</span>.</h2>
            </FadeIn>
            <SpotlightGrid>
              <Stagger className="lp-trust">
                {[
                  { i: "🛡️", t: "Private workspace", d: "Each business's documents, chats and leads are kept separate from everyone else's." },
                  { i: "🔐", t: "Encrypted keys", d: "WhatsApp and Telegram keys are stored encrypted, and every connection uses HTTPS." },
                  { i: "🎯", t: "No made-up answers", d: "The assistant only uses what you upload, and says so when it doesn't know." },
                  { i: "📦", t: "Export or delete any time", d: "Download your leads to Excel or delete your whole account in one click." },
                ].map((x) => (
                  <div key={x.t} className="spot lp-card lp-trust-card">
                    <span className="lp-trust-icon">{x.i}</span>
                    <h3>{x.t}</h3>
                    <p>{x.d}</p>
                  </div>
                ))}
              </Stagger>
            </SpotlightGrid>
          </div>
        </section>

        {/* ---------- pricing ---------- */}
        <section id="pricing" className="lp-section">
          <div className="lp-wrap">
            <FadeIn className="lp-head center">
              <p className="lp-eyebrow">Pricing</p>
              <h2 className="lp-h2">Costs less than <span className="lp-grad">one missed admission</span>.</h2>
              <p>{site.trialNote}</p>
            </FadeIn>
            <SpotlightGrid>
              <Stagger className="lp-plans">
                {site.plans.map((p) => (
                  <div key={p.name} className={`spot lp-card lp-plan${p.featured ? " featured" : ""}`}>
                    {p.featured && <span className="lp-plan-flag">Most popular</span>}
                    <h3>{p.name}</h3>
                    <p>{p.blurb}</p>
                    <div className="lp-price"><span className="cur">{site.currency}</span>{p.price}<span className="per">/month</span></div>
                    <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                    <Link href="/register" className={`btn block${p.featured ? "" : " secondary"}`}>Start free trial</Link>
                  </div>
                ))}
              </Stagger>
            </SpotlightGrid>
            {site.whatsapp && (
              <p className="lp-center-link">
                Want us to set it up for you? <a href={whatsappLink("Hi! I'd like a BotForge assistant for my business.")} target="_blank" rel="noopener noreferrer">Chat with us on WhatsApp →</a>
              </p>
            )}
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-narrow">
            <FadeIn className="lp-head center">
              <p className="lp-eyebrow">FAQ</p>
              <h2 className="lp-h2">Questions owners ask us.</h2>
            </FadeIn>
            <FadeIn><Faq items={FAQ} /></FadeIn>
          </div>
        </section>

        {/* ---------- final call to action ---------- */}
        <section className="lp-final">
          <div className="lp-beam" aria-hidden />
          <FadeIn className="lp-wrap lp-final-inner">
            <h2 className="lp-h2">Your next customer is on your website <span className="lp-grad">right now</span>.</h2>
            <p>Give them an answer before they leave.</p>
            <div className="lp-cta center">
              <Link href="/register" className="btn lg">Build your assistant free</Link>
              {site.whatsapp && (
                <a href={whatsappLink("Hi! I'd like to know more about BotForge.")} className="btn ghost lg" target="_blank" rel="noopener noreferrer">
                  Talk to us on WhatsApp
                </a>
              )}
            </div>
          </FadeIn>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-inner">
          <div>
            <Logo />
            <p>AI assistants for India&apos;s local businesses.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/demo">Demo</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/login">Log in</Link>
            <Link href="/register">Sign up</Link>
          </nav>
          <span>© {year} {site.name}{site.email && <> · <a href={`mailto:${site.email}`}>{site.email}</a></>}</span>
        </div>
      </footer>
    </div>
  );
}
