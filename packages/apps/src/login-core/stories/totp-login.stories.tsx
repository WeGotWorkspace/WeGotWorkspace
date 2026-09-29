import type { Meta, StoryObj } from "@storybook/react-vite";
import { TotpCodeForm } from "@/login-core/src/totp-code-form";
import { TotpWizard } from "@/login-core/src/totp-wizard";
import type { TotpWizardSource } from "@/lib/api/wgw/mfa-client";
import { AuthenticationPage } from "@/login-core/src/authentication-page";

const enrolled: TotpWizardSource = {
  mode: "enroll",
  username: "alice",
  presentation: "challenge",
  forced: true,
  start: async () => ({
    secret: "ABCDEFGHIJKLMNOP",
    otpauthUri: "otpauth://totp/WeGotWorkspace:alice?secret=ABCDEFGHIJKLMNOP",
    davWarning: true,
  }),
  confirm: async () => ({ recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] }),
};

const meta = {
  title: "Themes/Login/Two-factor",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AuthenticatorCode: Story = {
  render: () => (
    <AuthenticationPage title="Two-factor authentication">
      <TotpCodeForm username="alice" onSubmit={() => undefined} onUseRecovery={() => undefined} />
    </AuthenticationPage>
  ),
};

export const Enroll: Story = {
  render: () => (
    <TotpWizard source={enrolled} onFinished={() => undefined} onLogout={() => undefined} />
  ),
};

export const Replace: Story = {
  render: () => (
    <TotpWizard
      source={{ ...enrolled, mode: "replace" }}
      onFinished={() => undefined}
      onLogout={() => undefined}
    />
  ),
};

export const SessionForcedSetup: Story = {
  render: () => (
    <TotpWizard
      source={{ ...enrolled, presentation: "session", forced: true }}
      onFinished={() => undefined}
      onLogout={() => undefined}
    />
  ),
};
