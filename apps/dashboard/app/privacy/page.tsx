import LegalPage, { contact } from "@/components/LegalPage";
import { site } from "@/lib/site";

export const metadata = { title: `Privacy policy · ${site.name}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <nav className="sp-toc" aria-label="On this page">
        <a href="#roles">Who is responsible</a><a href="#collect">What we collect</a><a href="#providers">Who else handles it</a>
        <a href="#security">How we protect it</a><a href="#keep">How long we keep it</a><a href="#rights">Your rights</a><a href="#cookies">Cookies</a>
      </nav>

      <p>
        {site.name} (&quot;we&quot;, &quot;us&quot;) runs an AI assistant that businesses add to their website and messaging apps. It
        answers their customers from the business&apos;s own information and passes on enquiries. This policy explains
        exactly what personal data we handle, why, who else is involved, and your rights under India&apos;s Digital
        Personal Data Protection Act, 2023 (the DPDP Act).
      </p>

      <h2 id="roles">1. Who is responsible for what</h2>
      <ul>
        <li><strong>Business owners</strong> who create an account: we decide how account data is used, so we are its <em>data fiduciary</em>.</li>
        <li><strong>Customers who chat</strong> with a business&apos;s assistant: the business decides why it collects their questions
          and contact details, so the business is the data fiduciary and we process that data <em>on its behalf</em>
          (as its data processor), only to run the assistant. If you chatted with a business, contact that business first;
          we help it answer your request.</li>
      </ul>

      <h2 id="collect">2. What we collect, and why</h2>
      <table>
        <thead><tr><th>Data</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>Owner&apos;s business name, email address, password (stored only as a salted hash) or Google sign-in identity</td><td>To create and secure the account, reset passwords and send account emails.</td></tr>
          <tr><td>Documents, website pages and answers the business gives the assistant</td><td>The assistant answers only from these.</td></tr>
          <tr><td>Customers&apos; questions and the assistant&apos;s answers, with the page and time</td><td>To answer, to keep the context of a conversation, and so the business can read and improve the answers.</td></tr>
          <tr><td>Name, phone number, email and interest that a customer chooses to leave (a &quot;lead&quot;), with that chat</td><td>So the business can call back. The customer agrees to this in the form before sending it.</td></tr>
          <tr><td>Messaging-app details (WhatsApp number, Telegram or Instagram id and name) when a customer writes there</td><td>To reply in that app. On WhatsApp the number becomes a lead if the business has switched that on.</td></tr>
          <tr><td>Plan, usage counts and payment status</td><td>To apply plan limits and bill the business.</td></tr>
          <tr><td>IP address and request logs</td><td>Only for security: rate limits and investigating abuse.</td></tr>
        </tbody>
      </table>
      <p>We do not sell personal data, show advertising, or build profiles of customers.</p>

      <h2 id="providers">3. Who else handles the data</h2>
      <p>We use these providers to run the service. Each receives only what it needs:</p>
      <table>
        <thead><tr><th>Provider</th><th>What for</th><th>What it receives</th></tr></thead>
        <tbody>
          <tr><td>Render (servers, Singapore)</td><td>Runs the application</td><td>All service data in processing</td></tr>
          <tr><td>Neon (managed PostgreSQL)</td><td>Database</td><td>Stored account, knowledge, conversation and lead data (lead details encrypted)</td></tr>
          <tr><td>Vercel</td><td>Serves the website and dashboard pages</td><td>Page requests and IP addresses</td></tr>
          <tr><td>CloudAMQP (Mumbai)</td><td>Queue that hands documents to the reader</td><td>Document ids, never the content of chats</td></tr>
          <tr><td>Google (Gemini API)</td><td>Writes answers, reads documents, transcribes voice notes</td><td>The question, the matching passages of the business&apos;s documents, and voice notes</td></tr>
          <tr><td>Google (Sign in with Google)</td><td>Optional login</td><td>Only when the owner chooses it</td></tr>
          <tr><td>Brevo</td><td>Sends account emails and lead alerts</td><td>Recipient email and the email content</td></tr>
          <tr><td>Meta (WhatsApp, Instagram, Messenger), Telegram</td><td>Only if the business connects them</td><td>Messages exchanged in those apps, under their own terms</td></tr>
        </tbody>
      </table>
      <p>
        <strong>About Google Gemini:</strong> while {site.name} uses Google&apos;s free tier of the Gemini API, Google&apos;s terms
        allow it to use submitted content to improve its products. We will move to Google&apos;s paid tier, under which
        Google does not use content this way, as soon as paying customers support it, and update this policy. Until
        then, please do not upload documents containing customers&apos; personal or confidential data. Some providers
        process data outside India; we only use providers bound by contract to protect it.
      </p>

      <h2 id="security">4. How we protect it</h2>
      <ul>
        <li>All connections use HTTPS. Each business&apos;s data is kept separate and checked on every request.</li>
        <li>Customers&apos; names, phone numbers, emails and lead chats are <strong>encrypted in the database</strong> (AES-256-GCM).
          Messaging-app access keys are encrypted too and never shown in the browser.</li>
        <li>Passwords are stored as salted hashes; repeated wrong passwords lock the account for 15 minutes.</li>
        <li>Requests are rate-limited, uploads are checked, and production access is restricted to the operator.</li>
      </ul>
      <p>No system is perfectly secure. If a breach affects personal data, we will inform affected businesses and the Data Protection Board of India as the DPDP Act requires.</p>

      <h2 id="keep">5. How long we keep it</h2>
      <ul>
        <li>Conversations: deleted automatically after 180 days.</li>
        <li>Leads, documents and assistants: until the business deletes them or its account.</li>
        <li>Account deletion removes the business&apos;s data at once, except records the law requires us to keep (for example payment records).</li>
        <li>Security logs: kept briefly by our hosting providers and then discarded.</li>
      </ul>

      <h2 id="rights">6. Your rights</h2>
      <p>
        You may ask to see, correct or erase your personal data, withdraw consent, and nominate someone to act for you.
        Owners can do most of this themselves: <em>Plan &amp; account → Download my data</em> exports everything,
        individual leads and conversations can be deleted, and the whole account can be deleted. Customers of a business
        can ask that business, or write to us and we will forward the request within 7 days.
      </p>

      <h2 id="cookies">7. Cookies and browser storage</h2>
      <p>We use no advertising or tracking cookies and no analytics. We store only what the service needs, in your browser:</p>
      <ul>
        <li><strong>Login session</strong> (dashboard): keeps you logged in for up to an hour of use.</li>
        <li><strong>Chat continuity</strong> (the chat window on a business&apos;s website): keeps the current conversation while you browse that site; cleared when you close the tab.</li>
        <li><strong>Your notice choice</strong>: remembers that you have seen our storage notice.</li>
      </ul>
      <p>If you use Sign in with Google, Google sets its own cookies under Google&apos;s privacy policy.</p>

      <h2 id="children">8. Children</h2>
      <p>The dashboard is for businesses. Businesses that serve children (such as coaching institutes) should ask parents to leave contact details, not children.</p>

      <h2 id="contact">9. Contact and grievances</h2>
      <p>
        Questions, requests or complaints about personal data: {contact()}. We acknowledge within 2 working days and
        resolve within 7 days. If you are not satisfied, you can complain to the Data Protection Board of India.
      </p>

      <h2>10. Changes</h2>
      <p>We will post any change here with a new date, and email account owners before important changes take effect.</p>
    </LegalPage>
  );
}
