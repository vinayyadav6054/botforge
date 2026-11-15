import SitePage from "@/components/SitePage";
import { site } from "@/lib/site";

export const UPDATED = "15 November 2026";

export function contact() {
  return site.email ? <a href={`mailto:${site.email}`}>{site.email}</a> : <a href="/help#contact">our help centre</a>;
}

/** Privacy policy and terms: the public page layout with a "last updated" line. */
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SitePage eyebrow="Legal" title={title} intro={<p>Last updated: {UPDATED}</p>}>
      <div className="legal-body">{children}</div>
    </SitePage>
  );
}
