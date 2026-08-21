import { useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { wgwResetPasswordWithToken } from "@/lib/api/wgw/http";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type ResetPasswordScreenProps = {
  token?: string;
};

export function ResetPasswordScreen({ token }: ResetPasswordScreenProps = {}) {
  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const resolvedToken = (token ?? search.get("token") ?? "").trim();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    resolvedToken ? "" : "This reset link is invalid or has expired.",
  );

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    if (!resolvedToken) {
      setErrorMessage("This reset link is invalid or has expired.");
      return;
    }
    if (password.length < 10) {
      setErrorMessage("Use a password of at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await wgwResetPasswordWithToken(resolvedToken, password);
      setSubmitted(true);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message.trim() : "Could not update the password.";
      setErrorMessage(message || "This reset link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthenticationPage title="Choose a new password.">
      {errorMessage ? (
        <p className="login-screen__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {submitted ? (
        <div className="login-screen__success">
          <p>Your password was updated. Sign in with the new password.</p>
          <p className="login-screen__hint">
            <Link to="/login">Sign in</Link>
          </p>
        </div>
      ) : (
        <form className="login-screen__form" onSubmit={submitReset}>
          <FieldLabelRow htmlFor="password" label="New password">
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="At least 10 characters"
              required
              minLength={10}
              disabled={submitting || !resolvedToken}
            />
          </FieldLabelRow>
          <div className="login-screen__actions">
            <Button
              type="submit"
              label={submitting ? "Updating..." : "Update password"}
              variant="primary"
              size="lg"
              pill
              disabled={submitting || !resolvedToken}
              className="login-screen__submit"
            />
          </div>
          <p className="login-screen__hint">
            <Link to="/login">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthenticationPage>
  );
}
