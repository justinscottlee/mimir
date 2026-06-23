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
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);

  // Learn whether registration is open (to hide the sign-up affordance on
  // locked-down deployments) and which OAuth providers are configured (to show
  // their buttons only when they'll work). Defaults are conservative if the
  // probe fails: sign-up allowed, no social buttons.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setAllowSignup(Boolean(cfg.allowSignup));
        if (!cfg.allowSignup) setMode("signin");
        setGoogleEnabled(Boolean(cfg.social?.google));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  async function signInWithGoogle() {
    setError(null);
    setOauthBusy(true);
    try {
      // Better Auth redirects the browser to Google and back to callbackURL;
      // the session cookie is set on return and the shell picks it up. If the
      // call returns an error instead of redirecting, surface it.
      const { error } = await signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (error) {
        setError(error.message || "Could not sign in with Google.");
        setOauthBusy(false);
      }
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setOauthBusy(false);
    }
  }

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
          {googleEnabled && (
            <>
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={oauthBusy || busy}
                className="flex w-full items-center justify-center gap-2.5 rounded-md border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm font-medium text-parchment-100 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <GoogleMark />
                {oauthBusy
                  ? "Redirecting to Google…"
                  : mode === "signin"
                    ? "Continue with Google"
                    : "Sign up with Google"}
              </button>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-ink-800" />
                <span className="text-[11px] uppercase tracking-wide text-parchment-600">
                  or
                </span>
                <span className="h-px flex-1 bg-ink-800" />
              </div>
            </>
          )}

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

/** The official multicolor Google "G" mark, for the OAuth button. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

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
