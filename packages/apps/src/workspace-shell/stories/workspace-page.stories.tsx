import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings2 } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Switch } from "@/ui/switch";
import {
  WorkspacePageHeader,
  WorkspacePageSection,
  WorkspacePageTrail,
} from "@/workspace-shell/src/workspace-page";

/** The open page shared by Settings and Admin: trail, big title, sections of rows. */
function WorkspacePageExample() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <WorkspacePageTrail label="Settings" path="Device" onNavigate={() => {}} />
      <WorkspacePageHeader
        title="Appearance"
        description="Light or dark theme on this device"
        status={<Tag label="Saved" tone="success" dot />}
      />
      <WorkspacePageSection title="Display" icon={<Settings2 aria-hidden />}>
        <FieldLabelRow
          layout="inline"
          label="Reduce motion"
          description="Fewer animations across the suite."
          htmlFor="story-reduce-motion"
        >
          <Switch id="story-reduce-motion" />
        </FieldLabelRow>
      </WorkspacePageSection>
    </div>
  );
}

const meta = {
  title: "Workspace shell/Workspace page",
  component: WorkspacePageExample,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspacePageExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
