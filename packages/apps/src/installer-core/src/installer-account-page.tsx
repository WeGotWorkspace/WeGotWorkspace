import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  INSTALLER_PROGRESS_STEPS,
  installerCopy as copy,
} from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";
import {
  isInstallerEmailValid,
  isInstallerUsernameValid,
} from "@/installer-core/src/installer-username";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

/** Delay before showing typing-driven format errors. Hide is immediate when valid/empty. */
export const INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS = 350;

export type InstallerAccountValues = {
  username: string;
  email: string;
  password: string;
};

export type InstallerAccountPageProps = {
  initialUsername?: string;
  initialEmail?: string;
  initialPassword?: string;
  includeDatabaseStep?: boolean;
  usernameTaken?: boolean;
  installing?: boolean;
  onCreateWorkspace?: (values: InstallerAccountValues) => void;
};

function InstallerAccountPageTitle() {
  return (
    <>
      <InstallerHeadline italic="Your" noun="account" />.
    </>
  );
}

function InstallerFieldFeedback({ children }: { children?: ReactNode }) {
  const open = Boolean(children);
  return (
    <div
      className={
        open
          ? "installer__field-feedback"
          : "installer__field-feedback installer__field-feedback--hidden"
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

export function InstallerAccountPage({
  initialUsername = "",
  initialEmail = "",
  initialPassword = "",
  includeDatabaseStep = true,
  usernameTaken = false,
  installing = false,
  onCreateWorkspace,
}: InstallerAccountPageProps) {
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [username, setUsername] = useState(initialUsername);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);

  const usernameValid = isInstallerUsernameValid(username);
  const emailValid = isInstallerEmailValid(email);
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

  const progressLabel = INSTALLER_PROGRESS_STEPS[0];

  return (
    <InstallerLayout
      title={<InstallerAccountPageTitle />}
      step="account"
      includeDatabaseStep={includeDatabaseStep}
    >
      <form className="login-screen__form" onSubmit={handleSubmit}>
        <div className="installer__field">
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
          <InstallerFieldFeedback>
            {usernameTaken ? (
              <p className="installer__hint installer__hint--error">{copy.usernameTaken}</p>
            ) : showUsernameInvalid ? (
              <p className="installer__hint installer__hint--error">{copy.usernameInvalid}</p>
            ) : null}
          </InstallerFieldFeedback>
        </div>
        <div className="installer__field">
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
          <InstallerFieldFeedback>
            {showEmailInvalid ? (
              <p className="installer__hint installer__hint--error">{copy.emailInvalid}</p>
            ) : (
              <p className="installer__hint">{copy.emailHint}</p>
            )}
          </InstallerFieldFeedback>
        </div>
        <div className="installer__field">
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
          <InstallerFieldFeedback>
            {showPasswordInvalid ? (
              <p className="installer__hint installer__hint--error">{copy.passwordHint}</p>
            ) : (
              <p className="installer__hint">{copy.passwordHint}</p>
            )}
          </InstallerFieldFeedback>
        </div>

        {installing ? (
          <div className="installer__progress" role="status" aria-live="polite" aria-busy="true">
            <p className="sr-only">{progressLabel}</p>
            <ol className="installer__progress-steps" aria-label="Installation progress">
              <li
                className="installer__progress-step installer__progress-step--current"
                aria-current="step"
              >
                <span className="installer__progress-marker" aria-hidden>
                  <Loader2 className="installer__spinner" />
                </span>
                <span className="installer__progress-label">{progressLabel}</span>
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
    </InstallerLayout>
  );
}
