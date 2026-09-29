import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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

const account = {
  enabled: true,
  required: false,
  recoveryCodesRemaining: 2,
  suggest: false,
};

export const RecoveryWarning: Story = {
  args: {
    preview: {
      account,
      appPasswords: [],
    },
  },
};

export const WaitForNextCode: Story = {
  args: {
    preview: {
      account: { ...account, recoveryCodesRemaining: 10 },
      appPasswords: [],
      onCreateAppPassword: async () => {
        throw new MfaRequestError("Wait for the next code.", 401, "totp_step_reused");
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Name"), "Phone");
    const codes = canvas.getAllByLabelText("Authenticator code");
    await userEvent.type(codes[codes.length - 1]!, "123456");
    await userEvent.click(canvas.getByRole("button", { name: "Create app password" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Wait for the next code.");
  },
};
