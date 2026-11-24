import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthenticatorQrCode } from "@/two-factor-ui/src/authenticator-qr-code";
import {
  AuthenticatorSecretField,
  RecoveryCodesList,
  TwoFactorCodeField,
} from "@/two-factor-ui/src/two-factor-fields";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { OtpInput } from "@/ui/otp-input";
import { TooltipProvider } from "@/ui/tooltip";

const meta = {
  title: "Primitives/Two-factor",
  parameters: { layout: "padded" },
  tags: ["vitest-ci"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

const URI = `otpauth://totp/WeGotWorkspace:alice?secret=${MOCK_SIGN_IN.secret}&issuer=WeGotWorkspace`;

/** Drawn in the browser from the `otpauth://` URI; dark on white in both themes. */
export const QrCode: Story = {
  name: "AuthenticatorQrCode",
  render: () => <AuthenticatorQrCode uri={URI} />,
};

export const CodeField: Story = {
  name: "TwoFactorCodeField",
  render: function CodeFieldStory() {
    const [code, setCode] = useState("");
    const [recovery, setRecovery] = useState("");
    return (
      <div className="flex max-w-md flex-col gap-4">
        <TwoFactorCodeField value={code} onChange={setCode} />
        <TwoFactorCodeField value={recovery} onChange={setRecovery} recovery />
      </div>
    );
  },
};

export const SecretField: Story = {
  name: "AuthenticatorSecretField",
  render: () => (
    <TooltipProvider>
      <div className="max-w-xl">
        <AuthenticatorSecretField secret={MOCK_SIGN_IN.secret} layout="inline" />
      </div>
    </TooltipProvider>
  ),
};

export const RecoveryCodes: Story = {
  name: "RecoveryCodesList",
  render: function RecoveryCodesStory() {
    const [saved, setSaved] = useState(false);
    return (
      <div className="max-w-md">
        <RecoveryCodesList
          codes={MOCK_SIGN_IN.recoveryCodes}
          saved={saved}
          onSavedChange={setSaved}
        />
      </div>
    );
  },
};

/** Six boxes drawn from one real input: type, paste `123 456`, or let the phone fill it. */
export const OtpBoxes: Story = {
  name: "OtpInput",
  render: function OtpStory() {
    const [code, setCode] = useState("");
    const [sent, setSent] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [wrong, setWrong] = useState(false);
    return (
      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSent(code);
          setBusy(true);
          setWrong(false);
          setTimeout(() => {
            setBusy(false);
            setWrong(code !== "123456");
          }, 600);
        }}
      >
        <OtpInput
          aria-label="Code"
          value={code}
          onChange={setCode}
          disabled={busy}
          invalid={wrong}
          autoFocus
        />
        <p className="text-sm text-muted-foreground">
          {busy ? "Verifying…" : wrong ? "That code is not right (123456 works)." : "Try 123456."}
          {sent ? ` Sent: ${sent}` : ""}
        </p>
      </form>
    );
  },
};
