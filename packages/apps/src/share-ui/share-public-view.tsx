import type { FormEvent, ReactNode } from "react";
import { Button } from "@/button/src/button";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { shareLabels } from "@/share-ui/share-labels";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type SharePublicViewPhase = "loading" | "password" | "error" | "downloaded";

export type SharePublicViewProps = {
  phase: SharePublicViewPhase;
  password?: string;
  errorMessage?: string;
  submitting?: boolean;
  onPasswordChange?: (value: string) => void;
  onPasswordSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

function ShareHint({ children }: { children: ReactNode }) {
  return <p className="login-screen__hint mb-5 text-sm">{children}</p>;
}

function ShareError({ message }: { message: string }) {
  return (
    <p className="login-screen__error mb-5 text-sm" role="alert">
      {message}
    </p>
  );
}

export function SharePublicView({
  phase,
  password = "",
  errorMessage = "",
  submitting = false,
  onPasswordChange,
  onPasswordSubmit,
}: SharePublicViewProps) {
  if (phase === "loading") {
    return (
      <AuthenticationPage title={shareLabels.publicLinkOpeningTitle}>
        <ShareHint>{shareLabels.publicLinkOpeningHint}</ShareHint>
      </AuthenticationPage>
    );
  }

  if (phase === "downloaded") {
    return (
      <AuthenticationPage title={shareLabels.publicLinkDownloadTitle}>
        <ShareHint>{shareLabels.publicLinkDownloadHint}</ShareHint>
      </AuthenticationPage>
    );
  }

  if (phase === "error") {
    return (
      <AuthenticationPage title={shareLabels.publicLinkErrorTitle}>
        <ShareError message={errorMessage || shareLabels.publicLinkOpenError} />
        <ShareHint>
          {shareLabels.publicLinkErrorHint} <a href="/login">{shareLabels.publicLinkSignIn}</a>
        </ShareHint>
      </AuthenticationPage>
    );
  }

  return (
    <AuthenticationPage title={shareLabels.publicLinkPasswordTitle}>
      <ShareHint>{shareLabels.publicLinkPasswordHint}</ShareHint>
      {errorMessage ? <ShareError message={errorMessage} /> : null}

      <form className="space-y-2" onSubmit={onPasswordSubmit}>
        <FieldLabelRow label="Password">
          <Input
            id="share-password"
            name="password"
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            disabled={submitting}
            onChange={(event) => onPasswordChange?.(event.target.value)}
          />
        </FieldLabelRow>

        <div className="pt-4">
          <Button
            type="submit"
            label={submitting ? shareLabels.publicLinkOpeningTitle : shareLabels.publicLinkContinue}
            variant="primary"
            size="lg"
            pill
            disabled={submitting || !password.trim()}
            className="login-screen__submit"
          />
        </div>
      </form>
    </AuthenticationPage>
  );
}
