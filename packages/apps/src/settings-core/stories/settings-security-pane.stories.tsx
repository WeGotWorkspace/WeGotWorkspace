import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Security",
  component: SettingsSecurityPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsSecurityPane>;

export default meta;
type Story = StoryObj<typeof meta>;

const enrolled = {
  enabled: true,
  required: false,
  recoveryCodesRemaining: 2,
  suggest: false,
};

export const Off: Story = {
  tags: ["vitest-ci"],
  args: {
    preview: {
      account: {
        enabled: false,
        required: false,
        recoveryCodesRemaining: 0,
        suggest: false,
      },
      appPasswords: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("switch", { name: "Two-factor authentication" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(canvas.queryByLabelText("Password")).toBeNull();
    await expect(canvas.queryByLabelText("Authenticator code")).toBeNull();
    await userEvent.click(toggle);
    await expect(canvas.getByLabelText("Password")).toBeVisible();
    await expect(canvas.queryByLabelText("Code from the app")).toBeNull();
  },
};

export const RecoveryWarning: Story = {
  args: {
    preview: {
      account: enrolled,
      appPasswords: [],
    },
  },
};

export const WaitForNextCode: Story = {
  args: {
    preview: {
      account: { ...enrolled, recoveryCodesRemaining: 10 },
      appPasswords: [],
      onCreateAppPassword: async () => {
        throw new MfaRequestError("Wait for the next code.", 401, "totp_step_reused");
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create app password" }));
    const dialog = within(screen.getByRole("dialog", { name: "Create app password" }));
    await userEvent.type(dialog.getByLabelText("Name"), "Phone");
    await userEvent.type(dialog.getByLabelText("Authenticator code"), "123456");
    await userEvent.click(dialog.getByRole("button", { name: "Create" }));
    await expect(dialog.getByRole("alert")).toHaveTextContent("Wait for the next code.");
  },
};
