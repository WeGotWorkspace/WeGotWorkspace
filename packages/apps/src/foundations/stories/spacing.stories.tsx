import type { Meta, StoryObj } from "@storybook/react-vite";
import { SpacingSheet } from "../spacing-sheet";

/**
 * Interactive spacing token catalog. Live chrome stays under Themes.
 */
const meta = {
  title: "Foundations/Spacing",
  component: SpacingSheet,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Interactive catalog of the Tailwind spacing scale and control size tokens. Values are read from computed CSS.",
      },
    },
  },
} satisfies Meta<typeof SpacingSheet>;

export default meta;
type Story = StoryObj<typeof SpacingSheet>;

export const Sheet: Story = {};
