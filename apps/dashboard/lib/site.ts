/**
 * Everything on the public website that you will want to change: contact details, prices, demo bot.
 * Edit this file (or set the NEXT_PUBLIC_* variables on Vercel) and redeploy.
 */
export const site = {
  name: "Kahiye",
  tagline: "AI receptionist for your website",
  /** WhatsApp number with country code and no "+" or spaces, e.g. "919876543210". Empty hides the buttons. */
  whatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  /** Public key (bk_...) of a real bot made from public/samples/sunrise-academy.txt; empty = scripted demo only. */
  demoBotKey: process.env.NEXT_PUBLIC_DEMO_BOT_KEY ?? "",
  /** Your UPI ID for plan payments, e.g. "yourname@okaxis" (NEXT_PUBLIC_PAYMENT_UPI). Empty hides the UPI QR. */
  upiId: process.env.NEXT_PUBLIC_PAYMENT_UPI ?? "",
  /** Name shown in the customer's UPI app (should match the bank account), NEXT_PUBLIC_PAYMENT_NAME. */
  upiName: process.env.NEXT_PUBLIC_PAYMENT_NAME ?? "Kahiye",
  /** Public key (bk_...) of Kahiye's own assistant, made from /kahiye-assistant.txt: chats with visitors on the website. */
  siteBotKey: process.env.NEXT_PUBLIC_SITE_BOT_KEY ?? "",
  currency: "₹",
  trialNote: "14-day free trial. No card needed. Pay by UPI or card after that.",
  /**
   * Founding customer offer: the first 10 businesses pay 40% less, for as long as they stay. Set
   * NEXT_PUBLIC_FOUNDING_OFFER=off on Vercel when the 10 spots are taken (the dashboard also stops offering it then).
   */
  founding: {
    active: (process.env.NEXT_PUBLIC_FOUNDING_OFFER ?? "on") !== "off",
    spots: 10,
    title: "Founding customer offer",
    text: "Our first 10 businesses pay 40% less, for as long as they stay with us. Free setup included.",
  },
  plans: [
    {
      name: "Starter",
      price: "999",
      foundingPrice: "599",
      blurb: "For one website that gets regular questions.",
      features: ["1 assistant", "500 answers a month", "10 documents", "Website chat in Hindi & Hinglish", "Lead alerts by email & Google Sheets", "Booking & UPI buttons, live takeover"],
    },
    {
      name: "Business",
      price: "2,499",
      foundingPrice: "1,499",
      blurb: "For growing businesses with several services.",
      features: ["3 assistants", "3,000 answers a month", "50 documents", "WhatsApp, Instagram, Messenger, Telegram", "No “Powered by” badge"],
      featured: true,
    },
    {
      name: "Pro",
      price: "5,999",
      foundingPrice: "3,599",
      blurb: "For institutes, clinics and agencies with heavy traffic.",
      features: ["10 assistants", "15,000 answers a month", "200 documents", "Everything in Business", "Priority support + done-for-you setup"],
    },
  ],
};

export function whatsappLink(text: string): string {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}`;
}
