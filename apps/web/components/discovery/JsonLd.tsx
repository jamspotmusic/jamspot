/**
 * Renders a JSON-LD block into the page's HTML (TEA-67).
 *
 * Server-rendered, so the structured data is in the initial response rather
 * than injected after hydration. `JSON.stringify` output is escaped at "<" -
 * an event or venue name containing "</script>" would otherwise close the tag
 * early and break out into markup.
 */
export default function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
