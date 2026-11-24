import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectMark } from "@/projects-ui/src/project-mark";

const meta = {
  title: "Projects/Project Mark",
  component: ProjectMark,
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Project icon on a wash of the Project's color, as in the Meet, Drive and Docs sidebars. */
export const Colored: Story = { args: { color: "#3b82f6" } };

/** No color: the neutral wash. */
export const Neutral: Story = { args: {} };

export const Colors: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      {["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"].map((color) => (
        <ProjectMark key={color} color={color} />
      ))}
    </div>
  ),
};
