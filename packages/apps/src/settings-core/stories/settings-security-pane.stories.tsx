import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  createMockAppPasswordOperations,
  MOCK_ACCOUNT_PASSWORD,
  MOCK_APP_PASSWORDS,
} from "@/lib/api/mock/app-passwords";
import { createMockTwoFactorOperations } from "@/lib/api/mock/two-factor-settings";
import type { AppPasswordOperations } from "@/lib/api/wgw/app-passwords";
import { appPasswordLabels as labels } from "@/settings-core/src/settings-app-passwords-labels";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { twoFactorSettingsLabels } from "@/settings-core/src/settings-two-factor-labels";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Security",
  component: SettingsSecurityPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsSecurityPane>;

export default meta;
type Story = StoryObj<typeof SettingsSecurityPane>;

function story(operations: () => AppPasswordOperations, twoFactorOn = false): Story["render"] {
  return function SecurityStory() {
    const [ops] = useState(operations);
    const [twoFactor] = useState(() =>
      twoFactorOn
        ? {
            operations: createMockTwoFactorOperations({
              enabled: true,
              recoveryCodesRemaining: 10,
            }),
          }
        : undefined,
    );
    return (
      <SettingsStoryScope>
        <SettingsSecurityPane operations={ops} twoFactor={twoFactor} />
      </SettingsStoryScope>
    );
  };
}

/** Opens New app password and types a name and the given account password. */
async function fillCreateDialog(canvasElement: HTMLElement, accountPassword: string) {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(await page.findByRole("button", { name: labels.newButton }));
  const name = await page.findByLabelText(labels.nameLabel);
  // The dialog focuses its first field when it has opened; type after that.
  await waitFor(() => expect(name).toHaveFocus());
  await userEvent.type(name, "Work laptop");
  await userEvent.type(page.getByLabelText(labels.currentPasswordLabel), accountPassword);
  await waitFor(() => expect(name).toHaveValue("Work laptop"));
}

/** No app passwords yet. The account password is `storybook-dev`; `wrong` and `throttled` fail. */
export const Empty: Story = {
  render: story(() => createMockAppPasswordOperations()),
};

export const Filled: Story = {
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS)),
};

export const LoadFailed: Story = {
  render: story(() => createMockAppPasswordOperations([], { failList: true })),
};

/** The new password, shown once in groups of four, with a copy button. */
export const JustCreated: Story = {
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await fillCreateDialog(canvasElement, MOCK_ACCOUNT_PASSWORD);
    await userEvent.click(page.getByRole("button", { name: labels.create }));
    const secret = (await page.findByLabelText(labels.createdLabel)) as HTMLInputElement;
    await expect(secret.value).toMatch(/^[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}$/);
  },
};

export const WrongAccountPassword: Story = {
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await fillCreateDialog(canvasElement, "wrong");
    await userEvent.click(page.getByRole("button", { name: labels.create }));
    await expect(await page.findByText(labels.wrongPassword)).toBeInTheDocument();
  },
};

export const Throttled: Story = {
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await fillCreateDialog(canvasElement, "throttled");
    await userEvent.click(page.getByRole("button", { name: labels.create }));
    await expect(await page.findByText(labels.throttled(null))).toBeInTheDocument();
  },
};

/**
 * With two-factor on, a new app password asks for a current code instead of the account
 * password, like Replace recovery codes (decided by Wouter 2026-11-20). The code is `123456`.
 */
export const CreateWithTwoFactorOn: Story = {
  name: "Create with two-factor on",
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS), true),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await page.findByText(twoFactorSettingsLabels.statusOn);
    await userEvent.click(await page.findByRole("button", { name: labels.newButton }));
    const name = await page.findByLabelText(labels.nameLabel);
    await waitFor(() => expect(name).toHaveFocus());
    await userEvent.type(name, "Work laptop");
    await expect(page.queryByLabelText(labels.currentPasswordLabel)).toBeNull();
    await userEvent.type(page.getByLabelText(twoFactorLabels.codeLabel), "654321");
    await userEvent.click(page.getByRole("button", { name: labels.create }));
    await expect(await page.findByText(twoFactorSettingsLabels.wrongCode)).toBeInTheDocument();
    await expect(page.getByText(twoFactorLabels.clockHint)).toBeInTheDocument();
  },
};

export const ConfirmRemoveAll: Story = {
  render: story(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: labels.removeAllButton }));
    await expect(await page.findByText(labels.removeAllTitle)).toBeInTheDocument();
  },
};
