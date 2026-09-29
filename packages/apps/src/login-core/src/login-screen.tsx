import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { AuthLoginChallenge, type AuthLoginChallengeResult } from "@/lib/api/wgw/auth-login";
import {
  wgwEstablishMcpWebSession,
  wgwFetchPasswordRecoveryEnabled,
  wgwLoginWithCredentials,
  wgwLogout,
} from "@/lib/api/wgw/http";
import {
  challengeWizardSource,
  completeOAuthMfa,
  MfaRequestError,
  verifyMfaChallenge,
} from "@/lib/api/wgw/mfa-client";
import { isWgwOAuthAuthorizeReturnPath, sanitizeWgwReturnPath } from "@/lib/api/wgw/route-guard";
import { RecoveryCodeForm, TotpCodeForm } from "@/login-core/src/totp-code-form";
import { TotpWizard } from "@/login-core/src/totp-wizard";
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
  const [pending, setPending] = useState<AuthLoginChallengeResult | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);

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
      const oauthConnect = isWgwOAuthAuthorizeReturnPath(resolvedReturnPath);
      if (oauthConnect) {
        const intent = search.get("intent");
        await wgwEstablishMcpWebSession(normalizedUsername, password, intent);
        try {
          await wgwLoginWithCredentials(normalizedUsername, password);
        } catch {
          // Passport authorize needs the web session; SPA JWT is optional.
        }
        window.location.assign(resolvedReturnPath);
        return;
      }
      await wgwLoginWithCredentials(normalizedUsername, password);
      await navigate({ to: resolvedReturnPath });
    } catch (cause) {
      if (cause instanceof AuthLoginChallenge) {
        setPending(cause.login);
        setUseRecovery(false);
        setRuntimeError("");
        return;
      }
      const message = cause instanceof Error ? cause.message.trim() : "Could not sign in.";
      const normalized = message.toLowerCase();
      if (normalized.includes("invalid credentials") || normalized.includes("not recognized")) {
        setRuntimeError("That username or password does not match this server.");
      } else if (
        normalized.includes("too many login attempts") ||
        normalized.includes("too many sign-in attempts")
      ) {
        setRuntimeError("Too many sign-in attempts. Wait a few minutes and try again.");
      } else {
        setRuntimeError(message || "Could not sign in.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const oauthConnect = isWgwOAuthAuthorizeReturnPath(resolvedReturnPath);
  const wizardSource = useMemo(() => {
    if (!pending || pending.status === "mfa_required") return null;
    return challengeWizardSource(pending, username.trim());
  }, [pending, username]);

  const finishSignedIn = async () => {
    if (oauthConnect) {
      window.location.assign(resolvedReturnPath);
      return;
    }
    await navigate({ to: resolvedReturnPath });
  };

  const submitSecondFactor = async (body: { code?: string; recovery_code?: string }) => {
    if (!pending) return;
    setSubmitting(true);
    setRuntimeError("");
    try {
      const result =
        pending.client === "oauth"
          ? await completeOAuthMfa({
              challenge: pending.challenge,
              ...body,
              intent: search.get("intent"),
            })
          : await verifyMfaChallenge(pending.challenge, body);
      if (result.status === "ok") {
        await finishSignedIn();
        return;
      }
      setPending(result);
      setUseRecovery(false);
    } catch (cause) {
      const message =
        cause instanceof MfaRequestError ? cause.message : "That code was not accepted.";
      setRuntimeError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (wizardSource) {
    return (
      <TotpWizard
        source={wizardSource}
        onFinished={() => void finishSignedIn()}
        onLogout={() => {
          void wgwLogout();
          setPending(null);
          setPassword("");
        }}
      />
    );
  }

  if (pending?.status === "mfa_required") {
    return (
      <AuthenticationPage title="Two-factor authentication">
        {useRecovery ? (
          <RecoveryCodeForm
            username={username.trim()}
            submitting={submitting}
            error={runtimeError}
            onSubmit={(recoveryCode) => void submitSecondFactor({ recovery_code: recoveryCode })}
            onUseAuthenticator={() => {
              setUseRecovery(false);
              setRuntimeError("");
            }}
          />
        ) : (
          <TotpCodeForm
            username={username.trim()}
            submitting={submitting}
            error={runtimeError}
            onSubmit={(code) => void submitSecondFactor({ code })}
            onUseRecovery={
              pending.methods.includes("recovery")
                ? () => {
                    setUseRecovery(true);
                    setRuntimeError("");
                  }
                : undefined
            }
          />
        )}
      </AuthenticationPage>
    );
  }

  return (
    <AuthenticationPage title={oauthConnect ? "Connect Assistant" : "Welcome back."}>
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
            variant="password"
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
            size="xl"
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
