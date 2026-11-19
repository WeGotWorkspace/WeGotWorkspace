import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthenticatorQrCode } from "@/two-factor-ui/src/authenticator-qr-code";
import {
  AuthenticatorSecretField,
  RecoveryCodesList,
  TwoFactorCodeField,
} from "@/two-factor-ui/src/two-factor-fields";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
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
