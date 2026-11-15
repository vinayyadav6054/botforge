import Link from "next/link";
import SitePage from "@/components/SitePage";
import { site, whatsappLink } from "@/lib/site";

export const metadata = { title: `Help centre · ${site.name}`, description: "Simple step-by-step guides for setting up and using your Kahiye assistant." };

const TOPICS: { id: string; icon: string; title: string; steps: string[] }[] = [
  {
    id: "start", icon: "🚀", title: "Create your assistant (5 minutes)",
    steps: [
      "Click “Start free” and create your account. No card is needed.",
      "Click “New bot” and type your business name, for example “Sunrise Academy”.",
      "Open “Knowledge” and drop your brochure, fee list or FAQ (PDF, Word, Excel or text). Or paste your website address.",
      "Wait about a minute until the file shows a green “Ready”.",
      "Open “Test & answers” and ask a question a customer would ask. If an answer is wrong, click “Correct this answer”.",
    ],
  },
  {
    id: "website", icon: "🌐", title: "Put the chat on your website",
    steps: [
      "Open your assistant and click “Install”. Click “Copy snippet”.",
      "WordPress: install any “Header and Footer Scripts” plugin and paste the line in the footer box.",
      "Wix: Settings → Custom code → Add code → paste → “Body - end” → All pages.",
      "Shopify: Online Store → Themes → Edit code → theme.liquid → paste just before </body>.",
      "No website? Use the “Demo link” on the same page: put it in your Instagram bio, Google Business profile and WhatsApp status.",
    ],
  },
  {
    id: "leads", icon: "📞", title: "Get customers' numbers (leads)",
    steps: [
      "Open Settings → “Leads & alerts” and switch on “Ask visitors for their name and phone number”.",
      "Every enquiry appears under “Leads”, with the whole chat, and is emailed to you at once.",
      "Want leads in Google Sheets? Follow the 4 steps under “Send leads to a Google Sheet” on the same screen.",
      "Call new leads quickly: people who get a call within an hour are much more likely to join.",
    ],
  },
  {
    id: "whatsapp", icon: "🟢", title: "Answer on WhatsApp, Instagram and Telegram",
    steps: [
      "Open your assistant → “Messaging apps”. Telegram takes 2 minutes: create a bot with @BotFather and paste its token.",
      "WhatsApp and Instagram need a free Meta business app. The screen shows each step; we can also do it for you.",
      "WhatsApp only allows free replies within 24 hours of the customer's last message. After that, call them.",
    ],
  },
  {
    id: "takeover", icon: "🙋", title: "Reply to a customer yourself",
    steps: [
      "Open “Conversations”. A green dot means the customer is chatting right now.",
      "Open the chat and click “Take over”. The bot stops answering in that chat.",
      "Type your reply and press Send. On your website it appears within seconds; on WhatsApp it is sent from your number.",
      "Click “Hand back to bot” when you are done (it also happens by itself after 2 hours).",
    ],
  },
  {
    id: "billing", icon: "₹", title: "Plans and payment",
    steps: [
      "Every new account gets 14 days free with all features.",
      "To continue, open “Plan & account”, choose a plan and pay by UPI (GPay, PhonePe, Paytm). Your plan starts within a few hours of payment.",
      "There is no contract. If you stop paying, the assistant pauses. Your documents and leads stay in your account until you delete them, so you can restart any time.",
    ],
  },
  {
    id: "data", icon: "🔒", title: "Your data and your customers' data",
    steps: [
      "Only you can see your documents, chats and leads.",
      "Download everything any time: “Plan & account” → “Download my data”. Leads also export to Excel.",
      "Delete a single chat or lead, or your whole account, from the same screens. Deletion is permanent.",
      "Read the details in our Privacy policy.",
    ],
  },
];

export default function HelpPage() {
  return (
    <SitePage eyebrow="Help centre" title="How can we help?" wide
      intro={<p>Short, simple guides. If you get stuck anywhere, write to us and we will help you set it up.</p>}>
      <nav className="help-grid" aria-label="Topics">
        {TOPICS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="lp-card help-topic">
            <span className="lp-ico">{t.icon}</span>
            <h3>{t.title}</h3>
          </a>
        ))}
      </nav>

      <div className="help-guides">
        {TOPICS.map((t) => (
          <section key={t.id} id={t.id} className="help-guide">
            <h2><span aria-hidden>{t.icon}</span> {t.title}</h2>
            <ol>{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </section>
        ))}
      </div>

      <section id="contact" className="help-contact">
        <h2>Talk to us</h2>
        <p>We usually reply within one working day. We can also set up your assistant for you, free, during your trial.</p>
        <div className="help-contact-row">
          {site.whatsapp && (
            <a className="btn" href={whatsappLink("Hi Kahiye team, I need help with my assistant.")} target="_blank" rel="noopener noreferrer">
              Chat on WhatsApp
            </a>
          )}
          {site.email && <a className="btn secondary" href={`mailto:${site.email}?subject=Help%20with%20Kahiye`}>Email {site.email}</a>}
          <Link className="btn secondary" href="/account#support">Send a message from your account</Link>
        </div>
      </section>
    </SitePage>
  );
}
