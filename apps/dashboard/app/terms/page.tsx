import LegalPage, { contact } from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = { title: `Terms of service · ${site.name}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are the agreement between you (the business using {site.name}) and us. By creating an account you accept
        them. They are written to be read; if anything is unclear, ask us at {contact()}.
      </p>

      <h2>1. The service</h2>
      <p>
        {site.name} lets you create AI assistants that answer your customers on your website and messaging apps from
        information you provide, collect enquiries (leads) and let you reply yourself. Features and limits depend on your
        plan, shown on the pricing page and in <em>Plan &amp; account</em>.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and authorised to act for the business.</li>
        <li>Keep your password private. You are responsible for what happens in your account; tell us at once if you suspect misuse.</li>
        <li>Give a real email address: we use it for security messages, lead alerts and billing.</li>
      </ul>

      <h2>3. Free trial, plans and payment</h2>
      <ul>
        <li>New accounts get a 14-day free trial. No payment details are needed for the trial.</li>
        <li>Plans are monthly and paid in advance in Indian rupees (by UPI or another method we offer). Prices include any applicable taxes unless stated.</li>
        <li>Your plan starts once we confirm your payment, normally within a few working hours.</li>
        <li>You can stop at any time; the plan simply is not renewed. We do not refund part of a month already paid,
          except where the service was unavailable for a long period through our fault.</li>
        <li>If a plan ends, your assistants stop answering; your data stays in your account until you delete it.</li>
        <li>We may change prices with at least 30 days&apos; notice by email; the change applies from your next month.</li>
      </ul>

      <h2>4. Your content and your customers&apos; data</h2>
      <ul>
        <li>You own the documents and information you upload. You give us permission to store and process them only to provide the service to you.</li>
        <li>Upload only content you have the right to use. Do not upload other people&apos;s personal or confidential data (for example patient records or ID numbers) into the assistant&apos;s knowledge.</li>
        <li>For your customers&apos; data (questions, leads) you are the data fiduciary under the DPDP Act and we act on your
          behalf, as our <a href="/privacy">privacy policy</a> describes. Tell your customers how you use their details (for
          example in your own privacy notice) and use leads only to respond to their enquiry or as they agreed.</li>
      </ul>

      <h2>5. AI answers</h2>
      <p>
        The assistant answers from your information using an AI model. It is designed to stay within your documents and to
        say when it does not know, but AI can make mistakes. Check its answers in the playground and the conversation list,
        keep your documents up to date, and do not rely on it for medical, legal or financial advice. Prices, offers or
        commitments it states are only as accurate as the information you gave it.
      </p>

      <h2>6. Acceptable use</h2>
      <p>Do not use {site.name} to:</p>
      <ul>
        <li>break any law, or mislead, defraud or harass people;</li>
        <li>send spam or unsolicited messages (WhatsApp and other apps have their own rules, which you must follow);</li>
        <li>collect data from children without a parent&apos;s consent, or collect sensitive data the service is not built for;</li>
        <li>attack, overload, scrape or reverse-engineer the service, or get around plan limits or other customers&apos; separation.</li>
      </ul>
      <p>We may suspend an account that breaks these rules or puts the service or others at risk, and will tell you why unless the law prevents it.</p>

      <h2>7. Third-party services</h2>
      <p>
        Connecting WhatsApp, Instagram, Messenger, Telegram or Google is optional and governed also by those providers&apos;
        terms. Their fees (for example WhatsApp conversation charges from Meta) are between you and them.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep the service available and your data safe, but we do not guarantee uninterrupted service. We may
        improve or change features; we will give notice before removing a feature you pay for.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim is limited to the fees you paid us in the 3 months
        before the claim, and we are not liable for indirect losses such as lost profits or lost enquiries. Nothing in
        these terms limits liability that cannot be limited by law.
      </p>

      <h2>10. Ending the agreement</h2>
      <p>
        You can delete your account at any time in <em>Plan &amp; account</em>; this deletes your data as described in the
        privacy policy. Download anything you want to keep first.
      </p>

      <h2>11. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Please contact us first so we can try to resolve any problem;
        otherwise disputes go to the competent courts in India.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>We will post changes here with a new date and email you before important changes take effect. Continuing to use the service after that means you accept them.</p>
    </LegalPage>
  );
}
