import LegalPage, { contact } from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = { title: `Privacy Policy · ${site.name}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="note">
        This is a starting template. Have it reviewed by a lawyer and fill in your legal name and address before you
        take payments.
      </p>

      <p>
        {site.name} (&quot;we&quot;) provides AI chat assistants that businesses (&quot;customers&quot;) add to their websites.
        This policy explains what personal data we process, why, and your rights under India&apos;s Digital Personal
        Data Protection Act, 2023 (DPDP Act) and other applicable laws.
      </p>

      <h2>1. Two kinds of people, two roles</h2>
      <ul>
        <li>
          <strong>Our customers</strong> (business owners who sign up): we decide how their account data is used, so we
          are the <em>data fiduciary</em> for it.
        </li>
        <li>
          <strong>Website visitors</strong> who chat with a customer&apos;s assistant: the business decides why it collects
          their questions and contact details. We process that data <em>on the business&apos;s behalf</em> (as a data
          processor). Visitors should contact the business first about their data; we help the business respond.
        </li>
      </ul>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> business name, email address, password (stored only as a secure hash), plan and payment status.</li>
        <li><strong>Documents</strong> the business uploads (brochures, price lists, FAQs) and the text we extract from them.</li>
        <li><strong>Conversations:</strong> questions visitors ask, the assistant&apos;s answers, the page they were on, and the time.</li>
        <li><strong>Leads:</strong> name, phone number and optional details a visitor chooses to leave for a call back, with the chat that led to it.</li>
        <li><strong>Payments:</strong> handled by Razorpay. We receive the subscription status, never your card or UPI details.</li>
        <li><strong>Technical data:</strong> IP address and request logs, used only to keep the service secure (for example rate limits).</li>
      </ul>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To answer visitors&apos; questions from the business&apos;s documents and pass on enquiries to the business.</li>
        <li>To run the account: login, password reset, plan limits, billing and the monthly usage report email.</li>
        <li>To keep the service secure and prevent abuse.</li>
      </ul>
      <p>We do not sell personal data and we do not use it for advertising.</p>

      <h2>4. Service providers</h2>
      <p>
        We use carefully chosen providers to run the service: cloud hosting and database providers, an AI model
        provider (Google Gemini API) that receives the visitor&apos;s question and relevant document passages to write the
        answer, an email delivery provider, and Razorpay for payments. They may process data outside India, under
        contracts that require them to protect it.
      </p>

      <h2>5. How long we keep data</h2>
      <ul>
        <li>Conversations are deleted automatically after 180 days.</li>
        <li>Leads, documents and bots are kept until the business deletes them or closes its account.</li>
        <li>When a business deletes its account, all its data is deleted immediately, except what the law requires us to keep (such as invoices).</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        You can ask to access, correct or erase your personal data, withdraw consent, and nominate someone to exercise
        these rights for you. Businesses can export all their data and delete their account from the dashboard
        (Plan &amp; account), and delete individual leads or conversations at any time. Website visitors can ask the
        business, or contact us and we will forward the request.
      </p>

      <h2>7. Security</h2>
      <p>
        Data is encrypted in transit (HTTPS). Each business&apos;s data is kept separate, passwords are hashed, and access to
        production systems is restricted. No system is perfectly secure; if a breach affects you, we will inform you and
        the authorities as the law requires.
      </p>

      <h2>8. Children</h2>
      <p>The dashboard is for businesses and adults. We do not knowingly collect data from children without verifiable parental consent.</p>

      <h2>9. Contact and grievances</h2>
      <p>
        Questions, requests or complaints: contact us at {contact()}. We reply within 7 days. If you are not satisfied,
        you can complain to the Data Protection Board of India.
      </p>

      <h2>10. Changes</h2>
      <p>We will post changes here and email customers about important ones.</p>
    </LegalPage>
  );
}
