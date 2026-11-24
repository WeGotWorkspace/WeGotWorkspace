import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/authentication-page/src/authentication-page";
import {
  defaultSignInOperations,
  type SignInOperations,
  type SignInStep,
} from "@/lib/api/wgw/auth-sign-in";
import { wgwFetchPasswordRecoveryEnabled } from "@/lib/api/wgw/http";
import { isWgwOAuthAuthorizeReturnPath, sanitizeWgwReturnPath } from "@/lib/api/wgw/route-guard";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { clearLastAppLocations } from "@/app-rail/src/last-app-location";
import { forgetShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";
import { loginLabels as labels } from "@/login-core/src/login-labels";
import {
  LOGIN_ERROR_ID,
  LoginCodeStep,
  LoginRecoveryCodesStep,
  LoginReplaceStep,
} from "@/login-core/src/login-two-factor-steps";
import { useLoginSignIn, type LoginStep } from "@/login-core/src/use-login-sign-in";
import "./login-screen.css";

type LoginScreenError = "" | "invalid" | "throttled";

export type LoginScreenProps = {
  returnPath?: string;
  error?: LoginScreenError;
  passwordRecoveryEnabled?: boolean;
  /** Stories and tests; the app signs in against the API (no second step without one). */
  operations?: SignInOperations;
};

export function LoginScreen({
  returnPath,
  error = "",
  passwordRecoveryEnabled,
  operations,
}: LoginScreenProps = {}) {
  const navigate = useNavigate();
  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const resolvedReturnPath = sanitizeWgwReturnPath(returnPath ?? search.get("return"));
  const resolvedError = (error || search.get("error")?.trim() || "") as LoginScreenError;
  const oauthConnect = isWgwOAuthAuthorizeReturnPath(resolvedReturnPath);
  // Settings sends the user here after turning two-factor on (#2275).
  const twoFactorOn = search.get("notice") === "two-factor-on";
  const [signInOperations] = useState(
    () =>
      operations ??
      defaultSignInOperations(
        oauthConnect ? { kind: "oauth", intent: search.get("intent") } : { kind: "spa" },
      ),
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(passwordRecoveryEnabled ?? false);

  const finishSignIn = async (step: SignInStep) => {
    if (oauthConnect) {
      // The server keeps the full authorize query in the session and returns it here; the
      // login URL only carries `/oauth/authorize` (WAF-safe).
      const serverTarget = step.status === "ok" ? step.redirect : null;
      const useServerTarget =
        serverTarget !== null &&
        isWgwOAuthAuthorizeReturnPath(serverTarget) &&
        serverTarget.includes("?");
      window.location.assign(useServerTarget ? serverTarget : resolvedReturnPath);
      return;
    }
    await navigate({ href: resolvedReturnPath });
  };
  const signIn = useLoginSignIn(signInOperations, finishSignIn);

  // A session ended, however it ended (log out, expiry, another tab): the next
  // person in this tab must not inherit remembered spots or the Admin answer.
  useEffect(() => {
    clearLastAppLocations();
    forgetShowAdminApp();
  }, []);

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
    if (signIn.error) return signIn.error;
    return resolvedError === "invalid"
      ? labels.invalid
      : resolvedError === "throttled"
        ? labels.throttled(null)
        : "";
  }, [resolvedError, signIn.error]);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void signIn.submitPassword(username, password);
  };

  return (
    <AuthenticationPage title={loginTitle(signIn.step, oauthConnect)}>
      {errorMessage &&
      !(signIn.step.kind === "code" && !signIn.step.recovery && signIn.wrongCode) ? (
        <p id={LOGIN_ERROR_ID} className="login-screen__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {signIn.step.kind === "code" ? (
        <LoginCodeStep signIn={signIn} recovery={signIn.step.recovery} />
      ) : signIn.step.kind === "replace" ? (
        <LoginReplaceStep signIn={signIn} secret={signIn.step.secret} />
      ) : signIn.step.kind === "codes" ? (
        <LoginRecoveryCodesStep signIn={signIn} codes={signIn.step.codes} />
      ) : (
        <form className="login-screen__form" onSubmit={submitPassword}>
          {twoFactorOn && !errorMessage ? (
            <p className="login-screen__lead" role="status">
              {labels.twoFactorOn}
            </p>
          ) : null}
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
              disabled={signIn.busy}
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
              disabled={signIn.busy}
            />
          </FieldLabelRow>

          <div className="login-screen__actions">
            <Button
              type="submit"
              label={signIn.busy ? labels.signingIn : labels.signIn}
              variant="primary"
              size="xl"
              pill
              disabled={signIn.busy}
              className="login-screen__submit"
            />
          </div>
          {showForgot ? (
            <p className="login-screen__hint">
              <Link to="/login/forgot">Forgot password?</Link>
            </p>
          ) : null}
        </form>
      )}
    </AuthenticationPage>
  );
}

function loginTitle(step: LoginStep, oauthConnect: boolean): string {
  if (step.kind === "code") return labels.codeTitle;
  if (step.kind === "replace") return labels.replaceTitle;
  if (step.kind === "codes") return labels.codesTitle;
  return oauthConnect ? labels.connect : labels.welcome;
}
