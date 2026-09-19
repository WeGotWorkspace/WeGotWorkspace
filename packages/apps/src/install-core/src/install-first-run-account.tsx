import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  INSTALL_FIRST_RUN_PROGRESS_STEPS,
  installFirstRunCopy as copy,
} from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunHero } from "@/install-core/src/install-first-run-hero";
import { InstallFirstRunPage } from "@/install-core/src/install-first-run-page";
import {
  isInstallEmailValid,
  isInstallUsernameValid,
} from "@/install-core/src/install-first-run-username";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

/** Delay before showing typing-driven format errors. Hide is immediate when valid/empty. */
export const INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS = 350;

export type InstallFirstRunAccountValues = {
  username: string;
  email: string;
  password: string;
};

export type InstallFirstRunAccountProps = {
  initialUsername?: string;
  initialEmail?: string;
  initialPassword?: string;
  includeDatabaseStep?: boolean;
  usernameTaken?: boolean;
  installing?: boolean;
  onCreateWorkspace?: (values: InstallFirstRunAccountValues) => void;
};

function InstallFirstRunAccountTitle() {
  return (
    <>
      <InstallFirstRunHero italic="Your" noun="account" />.
    </>
  );
}

function InstallFirstRunFieldFeedback({ children }: { children?: ReactNode }) {
  const open = Boolean(children);
  return (
    <div
      className={
        open
          ? "install-first-run__field-feedback"
          : "install-first-run__field-feedback install-first-run__field-feedback--hidden"
      }
      {...(open ? { "aria-live": "polite" as const } : {})}
    >
      {children}
    </div>
  );
}

/**
 * Debounces *showing* format-validation feedback while typing; clears immediately when
 * the live condition is false so recovery feels snappy. Server errors (usernameTaken)
 * bypass this hook and render immediately.
 */
function useDebouncedShowFeedback(shouldShow: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!shouldShow) {
      setVisible(false);
      return;
    }
    const id = window.setTimeout(() => {
      setVisible(true);
    }, INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [shouldShow]);

  return visible;
}

export function InstallFirstRunAccount({
  initialUsername = "",
  initialEmail = "",
  initialPassword = "",
  includeDatabaseStep = true,
  usernameTaken = false,
  installing = false,
  onCreateWorkspace,
}: InstallFirstRunAccountProps) {
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [username, setUsername] = useState(initialUsername);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);

  const usernameValid = isInstallUsernameValid(username);
  const emailValid = isInstallEmailValid(email);
  const canSubmit =
    usernameValid && emailValid && password.length >= 10 && !usernameTaken && !installing;

  const usernameFormatInvalid = username.length > 0 && !usernameValid;
  const emailFormatInvalid = email.length > 0 && !emailValid;
  const passwordTooShort = password.length > 0 && password.length < 10;
  const showUsernameInvalid = useDebouncedShowFeedback(usernameFormatInvalid);
  const showEmailInvalid = useDebouncedShowFeedback(emailFormatInvalid);
  const showPasswordInvalid = useDebouncedShowFeedback(passwordTooShort);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onCreateWorkspace?.({ username, email, password });
  };

  const progressLabel = INSTALL_FIRST_RUN_PROGRESS_STEPS[0];

  return (
    <InstallFirstRunPage
      title={<InstallFirstRunAccountTitle />}
      step="account"
      includeDatabaseStep={includeDatabaseStep}
    >
      <form className="login-screen__form" onSubmit={handleSubmit}>
        <div className="install-first-run__field">
          <FieldLabelRow htmlFor={usernameId} label={copy.username}>
            <Input
              id={usernameId}
              name="username"
              value={username}
              autoComplete="username"
              spellCheck={false}
              placeholder="yourname"
              required
              disabled={installing}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FieldLabelRow>
          <InstallFirstRunFieldFeedback>
            {usernameTaken ? (
              <p className="install-first-run__hint install-first-run__hint--error">
                {copy.usernameTaken}
              </p>
            ) : showUsernameInvalid ? (
              <p className="install-first-run__hint install-first-run__hint--error">
                {copy.usernameInvalid}
              </p>
            ) : null}
          </InstallFirstRunFieldFeedback>
        </div>
        <div className="install-first-run__field">
          <FieldLabelRow htmlFor={emailId} label={copy.email}>
            <Input
              id={emailId}
              name="email"
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={installing}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FieldLabelRow>
          <InstallFirstRunFieldFeedback>
            {showEmailInvalid ? (
              <p className="install-first-run__hint install-first-run__hint--error">
                {copy.emailInvalid}
              </p>
            ) : (
              <p className="install-first-run__hint">{copy.emailHint}</p>
            )}
          </InstallFirstRunFieldFeedback>
        </div>
        <div className="install-first-run__field">
          <FieldLabelRow htmlFor={passwordId} label={copy.password}>
            <Input
              id={passwordId}
              name="password"
              variant="password"
              value={password}
              autoComplete="new-password"
              placeholder="••••••••"
              required
              minLength={10}
              disabled={installing}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FieldLabelRow>
          <InstallFirstRunFieldFeedback>
            {showPasswordInvalid ? (
              <p className="install-first-run__hint install-first-run__hint--error">
                {copy.passwordHint}
              </p>
            ) : (
              <p className="install-first-run__hint">{copy.passwordHint}</p>
            )}
          </InstallFirstRunFieldFeedback>
        </div>

        {installing ? (
          <div
            className="install-first-run__progress"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <p className="sr-only">{progressLabel}</p>
            <ol className="install-first-run__progress-steps" aria-label="Installation progress">
              <li
                className="install-first-run__progress-step install-first-run__progress-step--current"
                aria-current="step"
              >
                <span className="install-first-run__progress-marker" aria-hidden>
                  <Loader2 className="install-first-run__spinner" />
                </span>
                <span className="install-first-run__progress-label">{progressLabel}</span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="login-screen__actions">
            <Button
              type="submit"
              label={copy.createWorkspace}
              variant="primary"
              size="xl"
              pill
              className="login-screen__submit"
              disabled={!canSubmit}
            />
          </div>
        )}
      </form>
    </InstallFirstRunPage>
  );
}
