import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { LoginScreen } from "@/login-core/src/login-screen";
import { ForgotPasswordScreen } from "@/login-core/src/forgot-password-screen";
import { ResetPasswordScreen } from "@/login-core/src/reset-password-screen";

const meta: Meta<typeof LoginScreen> = {
  title: "Apps/Login",
  component: LoginScreen,
  parameters: {
    layout: "fullscreen",
    routerPath: "/login",
  },
};

export default meta;
type Story = StoryObj<typeof LoginScreen>;

export const Default: Story = {
  render: () => <LoginScreen passwordRecoveryEnabled />,
};

export const ConnectAssistant: Story = {
  name: "Connect assistant",
  parameters: {
    routerPath: "/login?return=%2Foauth%2Fauthorize",
    docs: {
      description: {
        story:
          "Same login screen as Default, with `return=/oauth/authorize` (MCP assistant connect). Live `/oauth/session` redirects here.",
      },
    },
  },
  render: () => <LoginScreen returnPath="/oauth/authorize" passwordRecoveryEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Connect assistant")).toBeTruthy();
    await expect(canvas.getByText("Welcome back.")).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeTruthy();
  },
};

export const RecoveryOff: Story = {
  name: "Recovery off",
  render: () => <LoginScreen passwordRecoveryEnabled={false} />,
};

export const ForgotRequestSuccess: Story = {
  name: "Forgot / request success",
  parameters: {
    routerPath: "/login/forgot",
  },
  render: () => <ForgotPasswordScreen />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Username or email"), "alice@example.test");
    await userEvent.click(canvas.getByRole("button", { name: "Send reset link" }));
    await expect(
      canvas.getByText(
        /if an account matches that username or email, a reset message was submitted/i,
      ),
    ).toBeInTheDocument();
  },
};

export const ResetForm: Story = {
  name: "Reset / form",
  parameters: {
    routerPath: "/login/reset?token=story-token",
  },
  render: () => <ResetPasswordScreen token="story-token" />,
};

export const ResetInvalidToken: Story = {
  name: "Reset / invalid token",
  parameters: {
    routerPath: "/login/reset",
  },
  render: () => <ResetPasswordScreen token="" />,
};
