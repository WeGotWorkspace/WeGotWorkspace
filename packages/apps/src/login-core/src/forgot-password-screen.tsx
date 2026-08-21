import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { wgwRequestPasswordReset } from "@/lib/api/wgw/http";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export function ForgotPasswordScreen() {
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    const normalized = identifier.trim();
    if (!normalized) {
      setErrorMessage("Username or email is required.");
      return;
    }

    setSubmitting(true);
    try {
      await wgwRequestPasswordReset(normalized);
      setSubmitted(true);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message.trim() : "Could not submit a reset request.";
      if (message.toLowerCase().includes("too many")) {
        setErrorMessage("Too many reset requests. Wait a few minutes and try again.");
      } else {
        setErrorMessage(message || "Could not submit a reset request.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthenticationPage title="Forgot password?">
      {errorMessage ? (
        <p className="login-screen__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {submitted ? (
        <div className="login-screen__success">
          <p>
            If an account matches that username or email, a reset message was submitted. This does
            not confirm that it reached an inbox.
          </p>
          <p className="login-screen__hint">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      ) : (
        <form className="login-screen__form" onSubmit={submitRequest}>
          <FieldLabelRow htmlFor="identifier" label="Username or email">
            <Input
              id="identifier"
              name="identifier"
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              placeholder="yourname or you@example.com"
              required
              disabled={submitting}
            />
          </FieldLabelRow>
          <div className="login-screen__actions">
            <Button
              type="submit"
              label={submitting ? "Submitting..." : "Send reset link"}
              variant="primary"
              size="lg"
              pill
              disabled={submitting}
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
