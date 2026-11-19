import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  createMockAppPasswordOperations,
  MOCK_ACCOUNT_PASSWORD,
  MOCK_APP_PASSWORDS,
} from "@/lib/api/mock/app-passwords";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { createMockTwoFactorOperations } from "@/lib/api/mock/two-factor-settings";
import type { TwoFactorOperations } from "@/lib/api/wgw/two-factor-settings";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { twoFactorSettingsLabels as labels } from "@/settings-core/src/settings-two-factor-labels";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Security/Two-factor",
  component: SettingsSecurityPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsSecurityPane>;

export default meta;
type Story = StoryObj<typeof SettingsSecurityPane>;

const signOut = fn(async () => {});

function story(
  operations: () => TwoFactorOperations,
  options: { unsynced?: number } = {},
): Story["render"] {
  return function TwoFactorStory() {
    const [twoFactor] = useState(() => ({
      operations: operations(),
      countUnsyncedChanges: async () => options.unsynced ?? 0,
      signOut,
    }));
    const [appPasswords] = useState(() => createMockAppPasswordOperations(MOCK_APP_PASSWORDS));
    return (
      <SettingsStoryScope>
        <SettingsSecurityPane operations={appPasswords} twoFactor={twoFactor} />
      </SettingsStoryScope>
    );
  };
}

const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/** Turn on → the account password → Next: the QR code and the setup key. */
async function startSetup(canvasElement: HTMLElement) {
  const body = page(canvasElement);
  await userEvent.click(await body.findByRole("button", { name: labels.turnOn }));
  const password = await body.findByLabelText(labels.currentPasswordLabel);
  await waitFor(() => expect(password).toHaveFocus());
  await userEvent.type(password, MOCK_ACCOUNT_PASSWORD);
  await userEvent.click(body.getByRole("button", { name: labels.next }));
  await body.findByRole("img", { name: twoFactorLabels.qrLabel });
}

async function typeCode(canvasElement: HTMLElement, code: string) {
  const field = await page(canvasElement).findByLabelText(twoFactorLabels.codeLabel);
  await waitFor(() => expect(field).toHaveFocus());
  await userEvent.type(field, code);
}

/** Off. The account password is `storybook-dev`, the code `123456` (`999999` pauses codes). */
export const Off: Story = {
  render: story(() => createMockTwoFactorOperations()),
};

export const On: Story = {
  render: story(() => createMockTwoFactorOperations({ enabled: true, recoveryCodesRemaining: 7 })),
};

export const NoRecoveryCodesLeft: Story = {
  render: story(() => createMockTwoFactorOperations({ enabled: true, recoveryCodesRemaining: 0 })),
};

export const LoadFailed: Story = {
  render: story(() => createMockTwoFactorOperations(undefined, { failState: true })),
};

/** The first step warns that this device has changes that are not synced yet. */
export const SetupWithUnsyncedChanges: Story = {
  render: story(() => createMockTwoFactorOperations(), { unsynced: 3 }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: labels.turnOn }));
    await expect(await body.findByText(labels.unsyncedNote(3))).toBeInTheDocument();
  },
};

export const SetupWrongPassword: Story = {
  render: story(() => createMockTwoFactorOperations()),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: labels.turnOn }));
    const password = await body.findByLabelText(labels.currentPasswordLabel);
    await waitFor(() => expect(password).toHaveFocus());
    await userEvent.type(password, "wrong");
    await userEvent.click(body.getByRole("button", { name: labels.next }));
    await expect(await body.findByText(labels.wrongPassword)).toBeInTheDocument();
  },
};

/** A calendar app used the account password lately: the setup says to make an app password. */
export const SetupScanWithDavWarning: Story = {
  render: story(() =>
    createMockTwoFactorOperations(undefined, { davPasswordUsedAt: "2026-11-18T21:40:00Z" }),
  ),
  play: async ({ canvasElement }) => {
    await startSetup(canvasElement);
    await expect(page(canvasElement).getByText(labels.davWarningTitle)).toBeInTheDocument();
  },
};

export const SetupWrongCode: Story = {
  render: story(() => createMockTwoFactorOperations()),
  play: async ({ canvasElement }) => {
    await startSetup(canvasElement);
    await typeCode(canvasElement, "000000");
    await userEvent.click(page(canvasElement).getByRole("button", { name: labels.turnOnConfirm }));
    await expect(await page(canvasElement).findByText(labels.wrongCode)).toBeInTheDocument();
    await expect(page(canvasElement).getByText(twoFactorLabels.clockHint)).toBeInTheDocument();
  },
};

/** The recovery codes: Done waits for "I saved these codes", then signs out. */
export const SetupRecoveryCodes: Story = {
  render: story(() => createMockTwoFactorOperations()),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await startSetup(canvasElement);
    await typeCode(canvasElement, MOCK_SIGN_IN.code);
    await userEvent.click(body.getByRole("button", { name: labels.turnOnConfirm }));
    await expect(await body.findByText(MOCK_SIGN_IN.recoveryCodes[0])).toBeInTheDocument();
    await expect(body.getByRole("button", { name: labels.done })).toBeDisabled();
  },
};

export const TurnOff: Story = {
  render: story(() => createMockTwoFactorOperations({ enabled: true, recoveryCodesRemaining: 9 })),
  play: async ({ canvasElement }) => {
    await userEvent.click(await page(canvasElement).findByRole("button", { name: labels.turnOff }));
    await expect(await page(canvasElement).findByText(labels.disableTitle)).toBeInTheDocument();
  },
};

export const CodesPaused: Story = {
  render: story(() => createMockTwoFactorOperations({ enabled: true, recoveryCodesRemaining: 9 })),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: labels.replaceCodes }));
    await typeCode(canvasElement, MOCK_SIGN_IN.throttledCode);
    await userEvent.click(body.getByRole("button", { name: labels.replaceConfirm }));
    await expect(await body.findByText(/^Too many tries\. Try again at /)).toBeInTheDocument();
  },
};
