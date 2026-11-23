export async function GET(): Promise<Response> {
  const body = [
    "# Collate Security Policy (RFC 9116)",
    "# [CONFIRM: replace with your live security contact email before public launch]",
    "Contact: mailto:security@collate.example",
    "Expires: 2027-11-23T00:00:00.000Z",
    "Preferred-Languages: en",
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
