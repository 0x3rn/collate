"use client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          backgroundColor: "#faf9f7",
          color: "#18181b",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "32rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            borderRadius: "12px",
            padding: "2rem",
          }}
        >
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.75rem" }}>Application error</h1>
          <p style={{ color: "#52525b", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
            Collate encountered an unexpected error. Please reload to continue.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "#71717a", margin: "0 0 1.25rem" }}>
              Reference ID: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: "#18181b",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "0.625rem 1.125rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
