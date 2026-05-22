type JsonLdProps = {
  id: string;
  data: Record<string, unknown> | Record<string, unknown>[];
};

const serializeJsonLd = (data: JsonLdProps["data"]) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export default function JsonLd({ id, data }: JsonLdProps) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
