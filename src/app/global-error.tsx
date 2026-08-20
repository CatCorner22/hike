"use client";

/**
 * Last-resort boundary, used when the root layout itself fails. It must render
 * its own <html> and <body>, and must not depend on app styling, providers or
 * fonts -- any of which may be the cause. Styles are inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Console only: this path must not assume a working network or reporting layer.
  if (typeof console !== "undefined") console.error("Hike failed to start", error);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#000", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <main
          role="alert"
          aria-live="assertive"
          style={{ maxWidth: "34rem", margin: "0 auto", padding: "2rem 1.25rem", lineHeight: 1.6 }}
        >
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 1rem" }}>Hike could not start</h1>
          <p style={{ fontSize: "1rem" }}>
            The app failed to load. Your saved plans, recorded tracks and offline maps are
            stored on this device and are not lost.
          </p>
          <p style={{ fontSize: "1rem", fontWeight: 600 }}>
            If you are on the trail, stop and navigate with your compass and paper backup
            until this recovers.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 56,
              width: "100%",
              marginTop: "1.5rem",
              borderRadius: 8,
              border: 0,
              background: "#fff",
              color: "#000",
              fontSize: "1.125rem",
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
