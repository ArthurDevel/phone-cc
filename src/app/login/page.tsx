/**
 * Login page for PhoneCC token-based authentication.
 *
 * - Provides a form to paste the access token
 * - POSTs the token to /api/auth/validate for server-side validation
 * - Redirects to / on success, shows error on failure
 */

"use client";

import { useState, type FormEvent } from "react";

// ============================================================================
// CONSTANTS
// ============================================================================

const VALIDATE_URL = "/api/auth/validate";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Login page with a centered token input form.
 */
export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --------------------------------------------------------------------------
  // EVENT HANDLERS
  // --------------------------------------------------------------------------

  /**
   * Submits the token to the validation endpoint.
   *
   * @param e - Form submit event
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError("");

    const trimmed = token.trim();
    if (!trimmed) {
      setError("Please enter a token.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });

      if (res.ok) {
        window.location.href = "/";
        return;
      }

      const data = await res.json();
      setError(data.error ?? "Authentication failed.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-1 text-lg font-semibold text-foreground">PhoneCC</h1>
        <p className="mb-6 text-sm text-muted">
          Paste your access token to continue.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="phcc_..."
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />

          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {isSubmitting ? "Validating..." : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
