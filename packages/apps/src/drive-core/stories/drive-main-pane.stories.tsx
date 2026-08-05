import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DRIVE_DOCS_EDITOR_STORY_FILES } from "@/drive-core/src/drive-docs-story-files";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { useDrivePaneStoryController } from "@/drive-core/stories/drive-pane-stories.harness";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import type { DriveFile } from "@/drive-core/src/drive-models";

const EMPTY_DRIVE_FILES: DriveFile[] = [];

function DriveMainPaneHarness({
  preset = "default",
  viewMode = "grid",
}: {
  preset?: "default" | "empty" | "docsEditor";
  viewMode?: "grid" | "list";
}) {
  const controller = useDrivePaneStoryController(
    preset === "empty"
      ? { filesOverride: EMPTY_DRIVE_FILES }
      : preset === "docsEditor"
        ? {
            filesOverride: [
              ...getDriveStoryFilesInMyDrive().filter((file) => file.kind === "folder"),
              ...DRIVE_DOCS_EDITOR_STORY_FILES,
            ],
          }
        : undefined,
  );
  const { setViewMode } = controller;

  useEffect(() => {
    setViewMode(viewMode);
  }, [setViewMode, viewMode]);

  return (
    <DriveStoryScope className="flex h-dvh flex-col">
      <DriveMainPane controller={controller} />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Apps/Drive/Panes/DriveMainPane",
  component: DriveMainPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "docsEditor"],
    },
    viewMode: {
      control: "radio",
      options: ["grid", "list"],
    },
  },
} satisfies Meta<typeof DriveMainPaneHarness>;

export default meta;
type Story = StoryObj<typeof DriveMainPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const folderTile = canvas.getByRole("button", { name: /Studio Assets/i });
    await userEvent.click(folderTile);
    await expect(canvas.getByText(/Archives/i)).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { preset: "empty" },
};

export const DocsEditorFiles: Story = {
  name: "Docs editor files (.md + .txt)",
  args: { preset: "docsEditor" },
};

export const GridView: Story = {
  name: "Grid view",
  tags: ["vitest-ci"],
  args: { preset: "docsEditor", viewMode: "grid" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Project Brief.md")).toBeInTheDocument();
    await expect(
      canvas.queryByText(/Opens in Docs with formatting toolbar/i),
    ).not.toBeInTheDocument();
  },
};

export const ListView: Story = {
  name: "List view (table)",
  tags: ["vitest-ci"],
  args: { preset: "default", viewMode: "list" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("table")).toBeInTheDocument();
    const studioAssets = canvas.getByText("Studio Assets");
    await userEvent.click(studioAssets);
    await expect(studioAssets.closest("tr")).toHaveClass(/drive-list-row--selected/);
  },
};

export const ListViewSelectionMode: Story = {
  name: "List view selection mode",
  tags: ["vitest-ci"],
  args: { preset: "default", viewMode: "list" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByText("Studio Assets").closest("tr");
    if (!row) throw new Error("Expected Studio Assets row");
    await userEvent.pointer({ keys: "[MouseRight>]", target: row });
    await expect(row).toHaveAttribute("data-selection-mode", "true");
    await expect(canvasElement.querySelector(".drive-list-row__checkbox")).toBeTruthy();
  },
};
