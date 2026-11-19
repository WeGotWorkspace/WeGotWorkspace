import { useEffect, useId, useRef } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { useAppToast } from "@/hooks/use-app-toast";
import { copyShareText } from "@/share-ui/share-path-utils";
import { Checkbox } from "@/ui/checkbox";
import { FieldLabelRow, type FieldLabelRowLayout } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { groupInFours, twoFactorLabels as labels } from "@/two-factor-ui/src/two-factor-labels";
import "./two-factor-ui.css";

type CodeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** A recovery code instead of a six-digit code from the app. */
  recovery?: boolean;
  layout?: FieldLabelRowLayout;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The id of a message about this field (a wrong code), for screen readers. */
  describedBy?: string;
};

/**
 * The code from the authenticator app (or a recovery code). The field takes a pasted
 * `123 456`; the one-time-code hint lets phones offer a code from the app or a message.
 */
export function TwoFactorCodeField({
  value,
  onChange,
  recovery = false,
  layout,
  disabled,
  autoFocus,
  describedBy,
}: CodeFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // `autoFocus` misses a field that mounts disabled (the step appears while its request ends).
  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);
  return (
    <FieldLabelRow
      htmlFor={id}
      layout={layout}
      fill={layout === "inline"}
      label={recovery ? labels.recoveryCodeLabel : labels.codeLabel}
    >
      <Input
        ref={inputRef}
        id={id}
        name={recovery ? "recovery_code" : "code"}
        className="two-factor-code-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={recovery ? "text" : "numeric"}
        autoComplete={recovery ? "off" : "one-time-code"}
        autoCapitalize="off"
        spellCheck={false}
        placeholder={recovery ? labels.recoveryCodePlaceholder : labels.codePlaceholder}
        maxLength={recovery ? 32 : 9}
        aria-invalid={describedBy ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        required
      />
    </FieldLabelRow>
  );
}

function useCopy(success: string) {
  const { showSuccess, showError } = useAppToast();
  return async (text: string) => {
    if (await copyShareText(text)) showSuccess(success);
    else showError(labels.copyFailed);
  };
}

/** The setup key as text, for a phone that cannot scan: grouped in fours, with copy. */
export function AuthenticatorSecretField({
  secret,
  layout,
}: {
  secret: string;
  layout?: FieldLabelRowLayout;
}) {
  const id = useId();
  const copy = useCopy(labels.copiedSecret);
  return (
    <FieldLabelRow
      htmlFor={id}
      layout={layout}
      fill={layout === "inline"}
      label={labels.secretLabel}
      description={labels.secretHint}
    >
      <div className="two-factor-secret">
        <Input
          id={id}
          value={groupInFours(secret)}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <IconButton
          type="button"
          variant="outline"
          size="md"
          icon={<Copy aria-hidden />}
          label={labels.copySecret}
          onClick={() => void copy(secret)}
        />
      </div>
    </FieldLabelRow>
  );
}

/**
 * Ten recovery codes, shown once, with copy and the "I saved them" box that the caller waits
 * for before it lets the person go on.
 */
export function RecoveryCodesList({
  codes,
  saved,
  onSavedChange,
}: {
  codes: readonly string[];
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}) {
  const checkboxId = useId();
  const copy = useCopy(labels.copiedCodes);
  return (
    <div>
      <ol className="two-factor-recovery-codes" aria-label={labels.recoveryCodeLabel}>
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="two-factor-recovery-codes__actions">
        <label className="two-factor-recovery-codes__saved" htmlFor={checkboxId}>
          <Checkbox
            id={checkboxId}
            checked={saved}
            onCheckedChange={(next) => onSavedChange(next === true)}
          />
          {labels.codesSaved}
        </label>
        <Button type="button" variant="outline" onClick={() => void copy(codes.join("\n"))}>
          <Copy aria-hidden />
          {labels.copyCodes}
        </Button>
      </div>
    </div>
  );
}
