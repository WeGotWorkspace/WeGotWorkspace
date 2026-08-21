import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { wgwFetchPasswordRecoveryEnabled, wgwLoginWithCredentials } from "@/lib/api/wgw/http";
import { sanitizeWgwReturnPath } from "@/lib/api/wgw/route-guard";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

type LoginScreenError = "" | "invalid" | "throttled";

export type LoginScreenProps = {
  returnPath?: string;
  error?: LoginScreenError;
  passwordRecoveryEnabled?: boolean;
};

export function LoginScreen({
  returnPath,
  error = "",
  passwordRecoveryEnabled,
}: LoginScreenProps = {}) {
  const navigate = useNavigate();
  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const resolvedReturnPath = sanitizeWgwReturnPath(returnPath ?? search.get("return"));
  const resolvedError = (error || search.get("error")?.trim() || "") as LoginScreenError;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [showForgot, setShowForgot] = useState(passwordRecoveryEnabled ?? false);

  useEffect(() => {
    if (passwordRecoveryEnabled !== undefined) {
      setShowForgot(passwordRecoveryEnabled);
      return;
    }
    let cancelled = false;
    void wgwFetchPasswordRecoveryEnabled().then((enabled) => {
      if (!cancelled) setShowForgot(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [passwordRecoveryEnabled]);
  const errorMessage = useMemo(() => {
    if (runtimeError.trim()) return runtimeError.trim();
    return resolvedError === "invalid"
      ? "That username or password does not match this server."
      : resolvedError === "throttled"
        ? "Too many sign-in attempts. Wait a few minutes and try again."
        : "";
  }, [resolvedError, runtimeError]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRuntimeError("");
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setRuntimeError("Username and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      await wgwLoginWithCredentials(normalizedUsername, password);
      await navigate({ to: resolvedReturnPath });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.trim() : "Could not sign in.";
      const normalized = message.toLowerCase();
      if (normalized.includes("invalid credentials")) {
        setRuntimeError("That username or password does not match this server.");
      } else if (normalized.includes("too many login attempts")) {
        setRuntimeError("Too many sign-in attempts. Wait a few minutes and try again.");
      } else {
        setRuntimeError(message || "Could not sign in.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthenticationPage title="Welcome back.">
      {errorMessage ? (
        <p className="login-screen__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <form className="login-screen__form" onSubmit={submitAuth}>
        <input type="hidden" name="return" value={resolvedReturnPath} />
        <FieldLabelRow htmlFor="username" label="Username">
          <Input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="yourname"
            required
            disabled={submitting}
          />
        </FieldLabelRow>

        <FieldLabelRow htmlFor="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            disabled={submitting}
          />
        </FieldLabelRow>

        <div className="login-screen__actions">
          <Button
            type="submit"
            label={submitting ? "Signing in..." : "Sign in"}
            variant="primary"
            size="lg"
            pill
            disabled={submitting}
            className="login-screen__submit"
          />
        </div>
        {showForgot ? (
          <p className="login-screen__hint">
            <Link to="/login/forgot">Forgot password?</Link>
          </p>
        ) : null}
      </form>
    </AuthenticationPage>
  );
}
