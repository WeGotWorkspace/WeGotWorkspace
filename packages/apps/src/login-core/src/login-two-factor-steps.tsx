import { useState, type FormEvent } from "react";
import { Button } from "@/button/src/button";
import { AuthenticatorQrCode } from "@/two-factor-ui/src/authenticator-qr-code";
import {
  AuthenticatorSecretField,
  RecoveryCodesList,
  TwoFactorCodeField,
} from "@/two-factor-ui/src/two-factor-fields";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { loginLabels as labels } from "@/login-core/src/login-labels";
import type { LoginSignIn } from "@/login-core/src/use-login-sign-in";

/** The id of the step's message, so the code field can point at it. */
export const LOGIN_ERROR_ID = "login-screen-error";

function SubmitButton({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <div className="login-screen__actions">
      <Button
        type="submit"
        label={busy ? busyLabel : label}
        variant="primary"
        size="xl"
        pill
        disabled={busy}
        className="login-screen__submit"
      />
    </div>
  );
}

function ClockHint({ show }: { show: boolean }) {
  return show ? <p className="login-screen__hint">{twoFactorLabels.clockHint}</p> : null;
}

/** The second step: a code from the app, or a recovery code. */
export function LoginCodeStep({ signIn, recovery }: { signIn: LoginSignIn; recovery: boolean }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void signIn.submitCode(value);
  };
  return (
    <form className="login-screen__form" onSubmit={submit} noValidate>
      <p className="login-screen__lead">{recovery ? labels.recoveryLead : labels.codeLead}</p>
      <TwoFactorCodeField
        key={recovery ? "recovery" : "code"}
        value={value}
        onChange={setValue}
        recovery={recovery}
        disabled={signIn.busy}
        autoFocus
        describedBy={signIn.error ? LOGIN_ERROR_ID : undefined}
        // A wrong app code is told under the boxes; a recovery code keeps the line above.
        error={!recovery && signIn.wrongCode ? signIn.error || undefined : undefined}
        clockHint={!recovery && signIn.wrongCode}
        labelHidden={!recovery}
        size="xl"
      />
      <SubmitButton busy={signIn.busy} label={labels.verify} busyLabel={labels.verifying} />
      <p className="login-screen__hint login-screen__links">
        <button
          type="button"
          className="login-screen__link"
          onClick={() => {
            setValue("");
            signIn.setRecovery(!recovery);
          }}
        >
          {recovery ? labels.useApp : labels.useRecovery}
        </button>
        <button
          type="button"
          className="login-screen__link login-screen__link--muted"
          onClick={signIn.startOver}
        >
          {labels.startOver}
        </button>
      </p>
    </form>
  );
}

/** After a recovery code: a new authenticator, confirmed with a code from it. */
export function LoginReplaceStep({
  signIn,
  secret,
}: {
  signIn: LoginSignIn;
  secret: { secret: string; otpauthUri: string };
}) {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void signIn.confirmReplacement(code);
  };
  return (
    <form className="login-screen__form" onSubmit={submit} noValidate>
      <p className="login-screen__lead">{labels.replaceLead}</p>
      <div className="login-screen__qr">
        <AuthenticatorQrCode uri={secret.otpauthUri} />
      </div>
      <AuthenticatorSecretField secret={secret.secret} />
      <TwoFactorCodeField
        value={code}
        onChange={setCode}
        disabled={signIn.busy}
        describedBy={signIn.error ? LOGIN_ERROR_ID : undefined}
      />
      <ClockHint show={signIn.wrongCode} />
      <SubmitButton busy={signIn.busy} label={labels.verify} busyLabel={labels.verifying} />
    </form>
  );
}

/** The new set of recovery codes; Continue waits for "I saved them". */
export function LoginRecoveryCodesStep({
  signIn,
  codes,
}: {
  signIn: LoginSignIn;
  codes: string[];
}) {
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saved) signIn.finishCodes();
  };
  return (
    <form className="login-screen__form" onSubmit={submit}>
      <p className="login-screen__lead">{labels.codesLead}</p>
      <RecoveryCodesList codes={codes} saved={saved} onSavedChange={setSaved} />
      <div className="login-screen__actions">
        <Button
          type="submit"
          label={labels.continue}
          variant="primary"
          size="xl"
          pill
          disabled={!saved || signIn.busy}
          className="login-screen__submit"
        />
      </div>
    </form>
  );
}
