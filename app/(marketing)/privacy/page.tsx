import Link from "next/link";
import { he } from "@/lib/i18n/he";

export const metadata = { title: he.privacy.title };

export default function PrivacyPage() {
  const p = he.privacy;
  return (
    <article className="prose prose-sm text-start">
      <h1>{p.title}</h1>
      <p>{p.version}</p>
      <p>
        <Link href="/settings">{p.manageLink}</Link>
      </p>
      {p.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body && <p>{section.body}</p>}
          {section.items.length > 0 && (
            <ul className="ps-5">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p>
        {p.contactLabel}{" "}
        <a href={`mailto:${p.contactEmail}`} dir="ltr">
          {p.contactEmail}
        </a>
      </p>
    </article>
  );
}
