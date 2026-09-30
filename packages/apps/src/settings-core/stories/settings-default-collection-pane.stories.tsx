import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  SettingsContactsPane,
  SettingsNotesPane,
  SettingsTasksPane,
} from "@/settings-core/src/settings-default-collection-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/DefaultCollection",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

export const Tasks: StoryObj = {
  render: () => (
    <SettingsStoryScope>
      <SettingsTasksPane />
    </SettingsStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Default list: Inbox/i });
    await expect(trigger.textContent).toContain("Inbox");
  },
};

export const Contacts: StoryObj = {
  render: () => (
    <SettingsStoryScope>
      <SettingsContactsPane />
    </SettingsStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Default address book: Personal/i });
    await expect(trigger.textContent).toContain("Personal");
  },
};

export const Notes: StoryObj = {
  render: () => (
    <SettingsStoryScope>
      <SettingsNotesPane />
    </SettingsStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Default notebook: The Journal/i });
    await expect(trigger.textContent).toContain("The Journal");
  },
};
