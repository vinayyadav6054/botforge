/**
 * Everything on the public website that you will want to change: contact details, prices, demo bot.
 * Edit this file (or set the NEXT_PUBLIC_* variables on Vercel) and redeploy.
 */
export const site = {
  name: "BotForge",
  tagline: "AI receptionist for your website",
  /** WhatsApp number with country code and no "+" or spaces, e.g. "919876543210". Empty hides the buttons. */
  whatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  /** Public key (bk_...) of a real bot made from public/samples/sunrise-academy.txt; empty = scripted demo only. */
  demoBotKey: process.env.NEXT_PUBLIC_DEMO_BOT_KEY ?? "",
  currency: "₹",
  trialNote: "14-day free trial. No card needed. Pay by UPI or card after that.",
  plans: [
    {
      name: "Starter",
      price: "499",
      blurb: "For one website that gets regular questions.",
      features: ["1 assistant", "500 answers a month", "10 documents", "Website chat in Hindi & Hinglish", "Lead alerts by email & Google Sheets", "Booking & UPI buttons, live takeover"],
    },
    {
      name: "Business",
      price: "1,499",
      blurb: "For growing businesses with several services.",
      features: ["3 assistants", "3,000 answers a month", "50 documents", "WhatsApp, Instagram, Messenger, Telegram", "No “Powered by” badge"],
      featured: true,
    },
    {
      name: "Pro",
      price: "3,999",
      blurb: "For institutes, clinics and agencies with heavy traffic.",
      features: ["10 assistants", "15,000 answers a month", "200 documents", "Everything in Business", "Priority support + done-for-you setup"],
    },
  ],
};

export function whatsappLink(text: string): string {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}`;
}
