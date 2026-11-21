"use client";

import { useEffect } from "react";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("[Collate] Unhandled route error:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: "#faf9f7",
        color: "#18181b",
      }}
    >
      <section
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
        <p
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#71717a",
            margin: 0,
          }}
        >
          Collate
        </p>
        <h1 style={{ fontSize: "1.375rem", margin: "0.5rem 0 0.75rem" }}>Something went wrong</h1>
        <p style={{ color: "#52525b", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
          An unexpected error occurred while rendering this page. Your work is safe—please try
          again.
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
          Try again
        </button>
      </section>
    </main>
  );
}
