export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#faf9f7",
        color: "#18181b",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          maxWidth: "42rem",
          width: "100%",
          backgroundColor: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: "14px",
          padding: "2.5rem",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#3f3f46",
            backgroundColor: "#f4f4f5",
            padding: "0.35rem 0.7rem",
            borderRadius: "999px",
          }}
        >
          Phase 0 · Foundations Active
        </div>

        <h1
          style={{
            fontSize: "2.25rem",
            letterSpacing: "-0.025em",
            margin: "1.25rem 0 0.75rem",
            lineHeight: 1.15,
          }}
        >
          Collate
        </h1>

        <p
          style={{
            fontSize: "1.0625rem",
            lineHeight: 1.65,
            color: "#3f3f46",
            margin: "0 0 1.75rem",
          }}
        >
          Evidence-bound research and long-form academic drafting—built chapter by chapter on
          verified sources, real citations, and server-side typesetting.
        </p>

        <div
          style={{
            borderTop: "1px solid #e4e4e7",
            paddingTop: "1.25rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.875rem",
            color: "#52525b",
          }}
        >
          <span>Runtime: Cloudflare Workers (vinext)</span>
          <a
            href="/api/health"
            style={{
              color: "#18181b",
              fontWeight: 500,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            Inspect /api/health →
          </a>
        </div>
      </div>
    </main>
  );
}
