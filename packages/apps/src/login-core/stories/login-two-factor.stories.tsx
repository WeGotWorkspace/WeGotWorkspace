import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createMockSignInOperations, MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import type { SignInOperations } from "@/lib/api/wgw/auth-sign-in";
import { loginLabels as labels } from "@/login-core/src/login-labels";
import { LoginScreen } from "@/login-core/src/login-screen";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";

const meta = {
  ...createBrandingStoryMeta({
    appId: "auth",
    workspaceClass: "login-screen",
    parameters: {
      routerPath: "/login",
      docs: {
        description: {
          component:
            "The second sign-in step (#2274), mock tier. Sign in as `alice` / `storybook-dev`; code `123456` works, " +
            "`999999` is throttled, `111111` has expired, recovery code `3f9a-c27e-81d4-0b6e` starts a new authenticator.",
        },
      },
    },
  }),
  title: "Themes/Login/Two-factor",
  tags: ["vitest-ci"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Screen({ returnPath, redirect }: { returnPath?: string; redirect?: string }) {
  const [operations] = useState<SignInOperations>(() => createMockSignInOperations({ redirect }));
  return <LoginScreen passwordRecoveryEnabled returnPath={returnPath} operations={operations} />;
}

type Page = ReturnType<typeof within>;

async function signInAsAlice(canvasElement: HTMLElement): Promise<Page> {
  const page = within(canvasElement);
  await userEvent.type(page.getByLabelText("Username"), MOCK_SIGN_IN.twoFactorUser);
  await userEvent.type(page.getByLabelText("Password"), MOCK_SIGN_IN.password);
  await userEvent.click(page.getByRole("button", { name: labels.signIn }));
  await page.findByRole("heading", { name: labels.codeTitle });
  return page;
}

async function enterCode(page: Page, code: string, recovery = false) {
  const field = page.getByLabelText(
    recovery ? twoFactorLabels.recoveryCodeLabel : twoFactorLabels.codeLabel,
  );
  await userEvent.clear(field);
  await userEvent.type(field, code);
  await userEvent.click(page.getByRole("button", { name: labels.verify }));
}

/** After the password: the code from the authenticator app. */
export const CodeStep: Story = {
  name: "Code step",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await expect(page.getByLabelText(twoFactorLabels.codeLabel)).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
  },
};

export const WrongCode: Story = {
  name: "Wrong code",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await enterCode(page, "654 321");
    await expect(await page.findByText(labels.wrongCode)).toBeInTheDocument();
    await expect(page.getByText(twoFactorLabels.clockHint)).toBeInTheDocument();
  },
};

export const Throttled: Story = {
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await enterCode(page, MOCK_SIGN_IN.throttledCode);
    await expect(await page.findByText(/^Too many sign-in attempts\. Try again at /)).toBeVisible();
  },
};

export const Expired: Story = {
  name: "Expired challenge",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await enterCode(page, MOCK_SIGN_IN.expiredCode);
    await expect(await page.findByText(labels.expired)).toBeVisible();
    await expect(page.getByLabelText("Username")).toBeVisible();
  },
};

export const TooManyWrongCodes: Story = {
  name: "Too many wrong codes",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    for (let i = 0; i <= MOCK_SIGN_IN.wrongCodeLimit; i++) await enterCode(page, "654 321");
    await expect(await page.findByText(labels.tooManyWrongCodes)).toBeVisible();
    await expect(page.getByLabelText("Username")).toBeVisible();
  },
};

export const RecoveryCode: Story = {
  name: "Recovery code",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await userEvent.click(page.getByRole("button", { name: labels.useRecovery }));
    await expect(await page.findByLabelText(twoFactorLabels.recoveryCodeLabel)).toBeVisible();
  },
};

/** After a recovery code: scan a new QR code and confirm a code from it. */
export const NewAuthenticator: Story = {
  name: "New authenticator",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await userEvent.click(page.getByRole("button", { name: labels.useRecovery }));
    await enterCode(page, MOCK_SIGN_IN.recoveryCode, true);
    await expect(await page.findByRole("img", { name: twoFactorLabels.qrLabel })).toBeVisible();
  },
};

export const NewRecoveryCodes: Story = {
  name: "New recovery codes",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const page = await signInAsAlice(canvasElement);
    await userEvent.click(page.getByRole("button", { name: labels.useRecovery }));
    await enterCode(page, MOCK_SIGN_IN.recoveryCode, true);
    await page.findByRole("img", { name: twoFactorLabels.qrLabel });
    await enterCode(page, MOCK_SIGN_IN.code);
    await page.findByRole("heading", { name: labels.codesTitle });
    await waitFor(() => expect(page.getByRole("button", { name: labels.continue })).toBeDisabled());
  },
};

export const ConnectAssistantCode: Story = {
  name: "Connect Assistant code step",
  parameters: { routerPath: "/login?return=%2Foauth%2Fauthorize" },
  render: () => <Screen returnPath="/oauth/authorize" redirect="/oauth/authorize?state=s" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { name: labels.connect }),
    ).toBeVisible();
    await signInAsAlice(canvasElement);
  },
};
