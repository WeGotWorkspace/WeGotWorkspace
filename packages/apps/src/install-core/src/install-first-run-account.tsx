import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  INSTALL_FIRST_RUN_PROGRESS_STEPS,
  installFirstRunCopy as copy,
} from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunHero } from "@/install-core/src/install-first-run-hero";
import { InstallFirstRunPage } from "@/install-core/src/install-first-run-page";
import { isInstallUsernameValid } from "@/install-core/src/install-first-run-username";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type InstallFirstRunAccountValues = {
  username: string;
  password: string;
};

export type InstallFirstRunAccountProps = {
  initialUsername?: string;
  initialPassword?: string;
  includeDatabaseStep?: boolean;
  usernameTaken?: boolean;
  installing?: boolean;
  progressStepIndex?: number;
  onCreateWorkspace?: (values: InstallFirstRunAccountValues) => void;
};

function InstallFirstRunAccountTitle() {
  return (
    <>
      <InstallFirstRunHero italic="Your" noun="account" />.
    </>
  );
}

export function InstallFirstRunAccount({
  initialUsername = "",
  initialPassword = "",
  includeDatabaseStep = true,
  usernameTaken = false,
  installing = false,
  progressStepIndex = 0,
  onCreateWorkspace,
}: InstallFirstRunAccountProps) {
  const usernameId = useId();
  const passwordId = useId();

  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState(initialPassword);

  const usernameValid = isInstallUsernameValid(username);
  const canSubmit = usernameValid && password.length >= 10 && !usernameTaken && !installing;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onCreateWorkspace?.({ username, password });
  };

  const clampedProgress = Math.min(
    INSTALL_FIRST_RUN_PROGRESS_STEPS.length - 1,
    Math.max(0, progressStepIndex),
  );

  return (
    <InstallFirstRunPage
      title={<InstallFirstRunAccountTitle />}
      step="account"
      includeDatabaseStep={includeDatabaseStep}
    >
      <form className="login-screen__form" onSubmit={handleSubmit}>
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
        <p className="install-first-run__hint">{copy.passwordHint}</p>

        {usernameTaken ? (
          <p className="install-first-run__hint install-first-run__hint--error" role="alert">
            {copy.usernameTaken}
          </p>
        ) : null}
        {username.length > 0 && !usernameValid ? (
          <p className="install-first-run__hint install-first-run__hint--error" role="alert">
            {copy.usernameInvalid}
          </p>
        ) : null}

        {installing ? (
          <div className="install-first-run__progress" role="status" aria-live="polite">
            <p className="install-first-run__progress-status">
              <Loader2 className="install-first-run__spinner" aria-hidden />
              {copy.installingStatus}
            </p>
            <ol className="install-first-run__progress-steps" role="list">
              {INSTALL_FIRST_RUN_PROGRESS_STEPS.map((label, index) => {
                const current = index === clampedProgress;
                const done = index < clampedProgress;
                return (
                  <li
                    key={label}
                    className={
                      current
                        ? "install-first-run__progress-step install-first-run__progress-step--current"
                        : done
                          ? "install-first-run__progress-step install-first-run__progress-step--done"
                          : "install-first-run__progress-step"
                    }
                  >
                    {label}
                  </li>
                );
              })}
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
