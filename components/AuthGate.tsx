"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "signin" | "signup";

/**
 * Full-screen authentication gate shown when no session is active. Mirrors the
 * Mimir dark / bronze / parchment palette and the Norse-myth framing of the
 * product (Mimir, keeper of the well of wisdom). On success Better Auth sets the
 * session cookie and `useSession()` upstream flips the shell into its loading →
 * ready lifecycle, so this component does not need to navigate anywhere itself.
 */
export default function AuthGate() {
  const [mode, setMode] = useState<Mode>("signin");
  const [allowSignup, setAllowSignup] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);

  // Learn whether registration is open so we can hide the sign-up affordance on
  // locked-down deployments. Defaults to allowed if the probe fails.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setAllowSignup(Boolean(cfg.allowSignup));
        if (!cfg.allowSignup) setMode("signin");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  async function submit() {
    setError(null);
    const mail = email.trim();
    if (!mail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await signIn.email({ email: mail, password });
        if (error) {
          setError(error.message || "Could not sign in.");
          return;
        }
      } else {
        const { error } = await signUp.email({
          email: mail,
          password,
          name: name.trim() || mail.split("@")[0],
        });
        if (error) {
          setError(error.message || "Could not create account.");
          return;
        }
      }
      // Success: the session cookie is now set. A reactive useSession() in the
      // shell picks this up; we nudge it along in case the hook is slow.
      window.location.reload();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !busy) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-app items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-sm">
        {/* Brand lockup */}
        <div className="mb-8 flex select-none flex-col items-center text-center">
          <div className="flex items-center justify-center gap-2.5">
            <span className="h-14 w-14">
              <img src="/mimir-brand-logo.svg" alt="Mimir logo" />
            </span>
            <span className="w-32">
              <img src="/mimir-brand-text.svg" alt="Mimir" />
            </span>
          </div>
          <p className="mt-5 max-w-xs text-sm text-parchment-600">
            {mode === "signin"
              ? "Your models, your data, all controlled by you."
              : "Create an account to get started managing your own LLMs."}
          </p>
        </div>

        <div className="rounded-lg border border-ink-800 bg-ink-900 p-6">
          <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
            {mode === "signup" && (
              <Field label="Name">
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                />
              </Field>
            )}

            <Field label="Email">
              <input
                ref={emailRef}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                className={inputClass}
              />
            </Field>

            {error && (
              <p className="text-sm text-signal-err" role="alert">
                {error}
              </p>
            )}

            <button
              onClick={submit}
              disabled={busy}
              className="mt-1 rounded-md bg-bronze-500 px-4 py-2.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </div>
        </div>

        {allowSignup && (
          <p className="mt-5 text-center text-sm text-parchment-600">
            {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setError(null);
                setMode((m) => (m === "signin" ? "signup" : "signin"));
              }}
              className="font-medium text-bronze-400 transition-colors hover:text-bronze-300"
            >
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 outline-none transition-colors focus:border-bronze-500";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-parchment-600">
        {label}
      </span>
      {children}
    </label>
  );
}
