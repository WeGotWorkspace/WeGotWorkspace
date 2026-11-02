import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { writeDocsPageSetupPrefs } from "@/lib/docs-page-setup";
import { SettingsDocsPane } from "@/settings-core/src/settings-docs-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Docs pane",
  component: SettingsDocsPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsDocsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default paper new documents start with. */
export const Default: Story = {
  beforeEach: () => {
    writeDocsPageSetupPrefs({ format: "a4", orientation: "portrait" });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Paper size" })).toHaveTextContent("A4");
    await expect(canvas.getByRole("combobox", { name: "Orientation" })).toBeEnabled();
  },
};

/** No paper: orientation does not apply. */
export const NoPaper: Story = {
  beforeEach: () => {
    writeDocsPageSetupPrefs({ format: "none" });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Paper size" })).toHaveTextContent("None");
    await expect(canvas.getByRole("combobox", { name: "Orientation" })).toBeDisabled();
  },
};
