import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createSpreadsheetAppBootstrap } from "@/lib/api/mock/spreadsheet-bootstrap";
import { createMockSpreadsheetOperations } from "@/spreadsheet-core/src/spreadsheet-mock-operations";
import { SpreadsheetWorkspace } from "@/spreadsheet-core/src/spreadsheet-workspace";
import "@/spreadsheet-core/src/spreadsheet-workspace.css";

const meta: Meta<typeof SpreadsheetWorkspace> = {
  title: "Apps/Sheets",
  component: SpreadsheetWorkspace,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof SpreadsheetWorkspace>;

const bootstrap = createSpreadsheetAppBootstrap();
const mockDocument = bootstrap.data.document!;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
};

export const ViewSource: Story = {
  name: "View source",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Toggle the source view on", async () => {
      const toggle = await canvas.findByRole("button", { name: "Edit source" });
      await userEvent.click(toggle);
    });

    await step("Source pane shows the live serialized YCSV", async () => {
      const source = await canvas.findByRole<HTMLTextAreaElement>("textbox", {
        name: "YCSV source",
      });
      await waitFor(() => {
        expect(source).toBeVisible();
        // The pane must render the live `.ycsv` document, not a blank textarea.
        expect(source.value.length).toBeGreaterThan(0);
        expect(source.value).toContain("ycsv_version: 1");
        expect(source.value).toContain("product,aantal,prijs,totaal,marge");
      });
    });
  },
};

export const InCellEditing: Story = {
  name: "In-cell editing",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    // Glide's overlay editor renders into #portal on document.body, outside the story root.
    const doc = canvasElement.ownerDocument;
    const findCellInput = () =>
      waitFor(() => {
        const el = doc.querySelector<HTMLInputElement>(".spreadsheet-cell-editor__input");
        if (!el)
          throw new Error("in-cell editor did not open (Glide #portal mount point missing?)");
        return el;
      });

    await step("Activating a cell opens the in-cell editor", async () => {
      // Click the first data cell on the canvas, then Enter to edit. This opens
      // Glide's overlay editor, which renders into #portal — the mount point that
      // was missing, breaking all in-cell editing.
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 100;
      const clientY = rect.top + 55;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      gridCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mousedown", opts));
      gridCanvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mouseup", opts));
      gridCanvas.dispatchEvent(new MouseEvent("click", opts));
      gridCanvas.focus();
      await userEvent.keyboard("{Enter}");
      const input = await findCellInput();
      const editor = input.closest(".spreadsheet-cell-editor");
      expect(editor).toBeTruthy();
      const chrome = doc.defaultView!.getComputedStyle(editor!);
      expect(chrome.borderTopWidth).not.toBe("0px");
      expect(chrome.boxShadow).not.toBe("none");
      await userEvent.clear(input);
      await userEvent.type(input, "Pears");
      await userEvent.keyboard("{Enter}");
    });

    await step("The edit is written back to the workbook", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "Edit source" }));
      const source = await canvas.findByRole<HTMLTextAreaElement>("textbox", {
        name: "YCSV source",
      });
      await waitFor(() => {
        expect(source.value).toContain("Pears,6,0.45");
      });
    });
  },
};

export const SheetStats: Story = {
  name: "Sheet stats footer",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The sample sheet has 5 columns and 5 data rows (header excluded).
    await waitFor(() => {
      expect(canvas.getByText("5 columns")).toBeInTheDocument();
      expect(canvas.getByText("5 rows")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(canvas.getByRole("button", { name: "Add row" })).toBeInTheDocument();
      expect(canvas.getByRole("button", { name: "Add column" })).toBeInTheDocument();
    });

    const addColumn = canvasElement.querySelector(
      ".spreadsheet-grid__insert-control--column",
    ) as HTMLElement;
    const addRow = canvasElement.querySelector(
      ".spreadsheet-grid__insert-control--row",
    ) as HTMLElement;
    expect(addColumn).toBeTruthy();
    expect(addRow).toBeTruthy();

    await waitFor(
      () => {
        const colLeft = Number.parseFloat(addColumn.style.left);
        const rowLeft = Number.parseFloat(addRow.style.left);
        const rowTop = Number.parseFloat(addRow.style.top);
        expect(Number.isFinite(colLeft)).toBe(true);
        expect(Number.isFinite(rowLeft)).toBe(true);
        expect(Number.isFinite(rowTop)).toBe(true);
        expect(colLeft).toBeGreaterThan(rowLeft + 50);
        expect(colLeft).toBeGreaterThan(200);
        expect(rowTop).toBeGreaterThan(20);
      },
      { timeout: 5000 },
    );
  },
};

export const AddRowColumn: Story = {
  name: "Add row and column",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Add row updates the footer row count", async () => {
      const addRow = await waitFor(() => canvas.getByRole("button", { name: "Add row" }));
      await userEvent.click(addRow);
      await waitFor(() => {
        expect(canvas.getByText("6 rows")).toBeInTheDocument();
      });
    });

    await step("Add column updates the footer column count", async () => {
      const addColumn = await waitFor(() => canvas.getByRole("button", { name: "Add column" }));
      await userEvent.click(addColumn);
      await waitFor(() => {
        expect(canvas.getByText("6 columns")).toBeInTheDocument();
      });
    });
  },
};

export const CreateSheet: Story = {
  name: "Create sheet",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Create sheet adds a second tab and switches to it", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "New sheet" }));
      await waitFor(() => {
        expect(canvas.getByRole("button", { name: "sheet2" })).toBeInTheDocument();
        expect(canvas.getByText("5 columns")).toBeInTheDocument();
        expect(canvas.getByText("5 rows")).toBeInTheDocument();
      });
    });

    await step("Serialized YCSV includes the new multi-sheet frontmatter", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "Edit source" }));
      const source = await canvas.findByRole<HTMLTextAreaElement>("textbox", {
        name: "YCSV source",
      });
      await waitFor(() => {
        expect(source.value).toContain("sheets:");
        expect(source.value).toContain("ref: sheet2");
      });
    });
  },
};

export const SheetSidebarActions: Story = {
  name: "Sheet sidebar actions",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const doc = canvasElement.ownerDocument;
    const actionButton = (row: Element, label: string) => {
      const button = (row as HTMLElement).querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
      if (!button) throw new Error(`Missing action button: ${label}`);
      return button;
    };

    const revealAndClick = async (row: Element, label: string) => {
      const button = actionButton(row, label);
      button.focus();
      await userEvent.click(button);
    };

    await step("Rename sheet updates display name while keeping ref stable", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "New sheet" }));
      const emptySheet = await canvas.findByRole("button", { name: "sheet2" });
      const emptyRow = emptySheet.closest(".spreadsheet-sheets-sidebar__item");
      expect(emptyRow).toBeTruthy();
      await revealAndClick(emptyRow!, "Rename sheet");
      const dialog = await waitFor(() => within(doc.body).getByRole("dialog"));
      const input = within(dialog).getByRole("textbox");
      await userEvent.clear(input);
      await userEvent.type(input, "Summary");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => {
        expect(canvas.getByRole("button", { name: "Summary" })).toBeInTheDocument();
      });
    });

    await step("Delete empty sheet asks for confirmation", async () => {
      const summarySheet = await canvas.findByRole("button", { name: "Summary" });
      const summaryRow = summarySheet.closest(".spreadsheet-sheets-sidebar__item");
      expect(summaryRow).toBeTruthy();
      await revealAndClick(summaryRow!, "Delete sheet");
      const confirm = await waitFor(() => within(doc.body).getByRole("alertdialog"));
      expect(within(confirm).getByText("Delete sheet?")).toBeInTheDocument();
      expect(
        within(confirm).getByText("“Summary” will be removed from this workbook."),
      ).toBeInTheDocument();
      await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(canvas.queryByRole("button", { name: "Summary" })).not.toBeInTheDocument();
        expect(within(doc.body).queryByRole("alertdialog")).not.toBeInTheDocument();
      });
    });

    await step("Delete sheet with data asks for confirmation", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "New sheet" }));
      const extraSheet = await canvas.findByRole("button", { name: "sheet2" });
      const dataSheet = await canvas.findByRole("button", { name: "sheet1" });
      const dataRow = dataSheet.closest(".spreadsheet-sheets-sidebar__item");
      expect(dataRow).toBeTruthy();
      await revealAndClick(dataRow!, "Delete sheet");
      const confirm = await waitFor(() => within(doc.body).getByRole("alertdialog"));
      expect(within(confirm).getByText("Delete sheet?")).toBeInTheDocument();
      expect(
        within(confirm).getByText("“sheet1” will be removed from this workbook."),
      ).toBeInTheDocument();
      await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(within(doc.body).queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(canvas.getByRole("button", { name: "sheet1" })).toBeInTheDocument();
        expect(canvas.getByRole("button", { name: "sheet2" })).toBeInTheDocument();
      });
      expect(extraSheet).toBeInTheDocument();
    });
  },
};

export const FormulaPicking: Story = {
  name: "Formula cell picking",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Activate a cell for formula editing", async () => {
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 180;
      const clientY = rect.top + 55;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      gridCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mousedown", opts));
      gridCanvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mouseup", opts));
      gridCanvas.dispatchEvent(new MouseEvent("click", opts));
    });

    await step("Focus formula bar and start a formula", async () => {
      const formulaInput = await canvas.findByPlaceholderText(/Type a value or =FORMULA/i);
      await userEvent.click(formulaInput);
      await userEvent.clear(formulaInput);
      await userEvent.type(formulaInput, "=");
      await waitFor(() => {
        expect(formulaInput).toHaveValue("=");
        expect(canvas.getByText("click cells to insert")).toBeInTheDocument();
      });
    });

    await step("Click a cell to insert its reference", async () => {
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 180;
      const clientY = rect.top + 80;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      gridCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mousedown", opts));
      gridCanvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mouseup", opts));
      gridCanvas.dispatchEvent(new MouseEvent("click", opts));

      const formulaInput = await canvas.findByPlaceholderText(/Type a value or =FORMULA/i);
      await waitFor(() => {
        expect(formulaInput.value).toMatch(/^=[a-z]+\d+$/i);
      });
    });
  },
};

export const FormulaInCellPicking: Story = {
  name: "Formula in-cell picking",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const doc = canvasElement.ownerDocument;
    const findCellInput = () =>
      waitFor(() => {
        const el = doc.querySelector<HTMLInputElement>(".spreadsheet-cell-editor__input");
        if (!el) throw new Error("in-cell editor did not open");
        return el;
      });

    await step("Open in-cell edit and start a formula", async () => {
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 100;
      const clientY = rect.top + 55;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      gridCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mousedown", opts));
      gridCanvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mouseup", opts));
      gridCanvas.dispatchEvent(new MouseEvent("click", opts));
      gridCanvas.focus();
      await userEvent.keyboard("{Enter}");
      const input = await findCellInput();
      await userEvent.clear(input);
      await userEvent.type(input, "=");
      await waitFor(() => {
        expect(input).toHaveValue("=");
        expect(canvasElement.querySelector(".spreadsheet-grid__pick-shield")).toBeTruthy();
      });
    });

    await step("Click another cell keeps the editor open and inserts a ref", async () => {
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 180;
      const clientY = rect.top + 80;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      const shield = await waitFor(() => {
        const el = canvasElement.querySelector(".spreadsheet-grid__pick-shield");
        if (!el) throw new Error("pick shield not visible");
        return el;
      });
      shield.dispatchEvent(new MouseEvent("mousedown", opts));

      const input = await findCellInput();
      await waitFor(() => {
        expect(input.value).toMatch(/^=[a-z]+\d+$/i);
        expect(doc.querySelector(".spreadsheet-cell-editor__input")).toBe(input);
      });
    });
  },
};

export const FormatBar: Story = {
  name: "Format bar",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Format bar appears when a cell is selected", async () => {
      const gridCanvas = await canvas.findByTestId("data-grid-canvas");
      const rect = gridCanvas.getBoundingClientRect();
      const clientX = rect.left + 100;
      const clientY = rect.top + 55;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      gridCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mousedown", opts));
      gridCanvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
      gridCanvas.dispatchEvent(new MouseEvent("mouseup", opts));
      gridCanvas.dispatchEvent(new MouseEvent("click", opts));

      await waitFor(() => {
        expect(canvas.getByRole("toolbar", { name: "Cell formatting" })).toBeInTheDocument();
        expect(canvas.getByRole("button", { name: "Bold" })).toBeInTheDocument();
        expect(canvas.getByRole("button", { name: "Border" })).toBeInTheDocument();
        expect(canvas.getByRole("button", { name: "Fill color" })).toBeInTheDocument();
      });
    });

    await step("Bold toggle writes cells frontmatter", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Bold" }));
      await userEvent.click(await canvas.findByRole("button", { name: "Edit source" }));
      const source = await canvas.findByRole<HTMLTextAreaElement>("textbox", {
        name: "YCSV source",
      });
      await waitFor(() => {
        expect(source.value).toContain("cells:");
        expect(source.value).toContain("bold: true");
      });
    });
  },
};

export const RowSelect: Story = {
  name: "Row select",
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
};

export const Empty: Story = {
  name: "No spreadsheet",
  args: {
    ...bootstrap,
    data: { document: null },
    onLogout: () => {},
  },
};

export const SchemaPanel: Story = {
  name: "Schema panel",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath: mockDocument.apiPath,
    operations: createMockSpreadsheetOperations(),
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Open the schema panel", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "Schema" }));
    });

    await step("Defs and column editors are visible", async () => {
      const panel = await canvas.findByRole("complementary", { name: "Sheet schema" });
      const inPanel = within(panel);

      await waitFor(() => {
        expect(inPanel.getByRole("button", { name: "Defs" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(inPanel.getByDisplayValue("btw")).toBeInTheDocument();
      });

      await userEvent.click(inPanel.getByRole("button", { name: "Columns" }));
      await waitFor(() => {
        expect(inPanel.getByRole("button", { name: "Columns" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(inPanel.getAllByLabelText("Ref")[0]).toHaveValue("product");
        expect(inPanel.getByDisplayValue("Prijs ex. BTW")).toBeInTheDocument();
      });
    });

    await step("Mapping key input keeps focus while typing", async () => {
      const panel = canvas.getByRole("complementary", { name: "Sheet schema" });
      const inPanel = within(panel);
      await userEvent.click(inPanel.getByRole("button", { name: "Defs" }));
      await userEvent.click(await inPanel.findByRole("button", { name: "Add mapping" }));
      const keyInput = await inPanel.findByLabelText("Key");
      await userEvent.click(keyInput);
      await userEvent.type(keyInput, "extra");
      expect(document.activeElement).toBe(keyInput);
      expect(keyInput).toHaveValue("keyextra");
    });

    await step("Editing a def updates serialized YCSV", async () => {
      const panel = canvas.getByRole("complementary", { name: "Sheet schema" });
      const inPanel = within(panel);
      const btwInput = inPanel.getByDisplayValue("0.21");
      await userEvent.clear(btwInput);
      await userEvent.type(btwInput, "0.19");
      await userEvent.tab();
      await userEvent.click(await canvas.findByRole("button", { name: "Edit source" }));
      const source = await canvas.findByRole<HTMLTextAreaElement>("textbox", {
        name: /YCSV source/,
      });
      await waitFor(() => {
        expect(source.value).toContain("btw: 0.19");
      });
    });
  },
};
