import type { Meta, StoryObj } from "@storybook/react-vite";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/ui/tooltip";
import { SpreadsheetMainPane } from "@/spreadsheet-core/src/spreadsheet-main-pane";
import { useSpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";
import { SAMPLE_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";
import "@/spreadsheet-core/src/spreadsheet-workspace.css";

const initialDocument = {
  apiPath: "/users/demo/budget.ycsv",
  fileName: "budget.ycsv",
  content: SAMPLE_YCSV,
};

function GridHarness({ viewSource }: { viewSource: boolean }) {
  const controller = useSpreadsheetController({ filePath: null, initialDocument });
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn("spreadsheet-workspace", viewSource && "spreadsheet-workspace--view-source")}
        style={{ height: "100vh", display: "flex" }}
      >
        <SpreadsheetMainPane controller={controller} viewSource={viewSource} />
      </div>
    </TooltipProvider>
  );
}

const meta: Meta<typeof GridHarness> = {
  title: "Apps/Sheets/Grid",
  component: GridHarness,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof GridHarness>;

export const Grid: Story = {
  tags: ["vitest-ci"],
  args: { viewSource: false },
};

export const WithSource: Story = {
  name: "Source toggle",
  args: { viewSource: true },
};
