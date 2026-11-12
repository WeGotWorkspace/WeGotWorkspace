import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { withDarkTheme } from "@/branding-playground";
import { DocxImportReportDialog } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { buildDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report";

/** A Word file with a bit of everything the converter leaves out (#1619, #1983). */
const report = buildDocxImportReport(
  "Project plan.docx",
  {
    comments: 2,
    trackedChanges: 2,
    headersAndFooters: 2,
    footnotes: 1,
    endnotes: 1,
    textBoxes: 1,
    textBoxesAsText: 1,
    alignment: 3,
    pageBreaks: 0,
    sections: 1,
    fonts: 2,
    colours: 1,
    embeddedObjects: 1,
  },
  1,
);

const meta = {
  title: "Features/Docs/Word import report",
  component: DocxImportReportDialog,
  tags: ["vitest-ci"],
  args: { report, surfaceClassName: "docs-dialog-surface", onClose: fn() },
} satisfies Meta<typeof DocxImportReportDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectReport() {
  // The dialog is portaled to the body, outside the story canvas.
  const dialog = await within(document.body).findByRole("dialog");
  await expect(dialog).toHaveTextContent("Some parts did not come across");
  await expect(dialog).toHaveTextContent("2 comments");
  await expect(dialog).toHaveTextContent("1 text box (the text is kept, without the box)");
  await expect(dialog).toHaveTextContent("1 image that could not be added");
}

export const Light: Story = {
  play: async () => {
    await expectReport();
    await expect(document.documentElement.dataset.theme).not.toBe("dark");
  },
};

export const Dark: Story = {
  name: "Dark theme",
  decorators: [withDarkTheme],
  play: async () => {
    await expectReport();
    await expect(document.documentElement.dataset.theme).toBe("dark");
  },
};
