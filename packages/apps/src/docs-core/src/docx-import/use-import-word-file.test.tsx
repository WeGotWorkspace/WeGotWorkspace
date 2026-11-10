import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocxSaveRefusedError } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { useImportWordFile } from "@/docs-core/src/docx-import/use-import-word-file";
import { WordFilePickerInput } from "@/docs-core/src/docx-import/word-file-picker-input";

const { show, dismiss, showError, online, runImport } = vi.hoisted(() => ({
  show: vi.fn(() => "toast-1"),
  dismiss: vi.fn(),
  showError: vi.fn(),
  online: { value: true },
  runImport: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, dismiss, showSuccess: vi.fn(), showError }),
}));
vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: online.value }),
}));
vi.mock("@/docs-core/src/docx-import/load-docx-converter", () => ({
  runImportDocxFile: runImport,
}));

function setup(enabled = true) {
  const onOpenDocsFile = vi.fn();
  const hook = renderHook(() =>
    useImportWordFile({ enabled, onOpenDocsFile, dialogSurfaceClassName: "docs-dialog-surface" }),
  );
  return { hook, onOpenDocsFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  online.value = true;
});

describe("useImportWordFile", () => {
  it("offers Import docx file(s) without a subtitle, and nothing when disabled", () => {
    const [item, ...rest] = setup().hook.result.current.menuItems;
    expect(item.label).toBe("Import docx file(s)");
    expect(item.description).toBeUndefined();
    expect(rest).toEqual([]);
    const disabled = setup(false).hook.result.current;
    expect(disabled.menuItems).toEqual([]);
    expect(disabled.importFiles).toBeUndefined();
  });

  it("is disabled with a reason while offline", () => {
    online.value = false;
    const [item] = setup().hook.result.current.menuItems;
    expect(item.disabled).toBe(true);
    expect(item.description).toMatch(/connection/i);
  });

  it("imports the picked file and opens the new Doc", async () => {
    runImport.mockResolvedValue({
      docPath: "/users/ann/Plan.md",
      report: { sourceName: "Plan.docx", lines: [] },
    });
    const { hook, onOpenDocsFile } = setup();
    const file = new File(["x"], "Plan.docx");
    act(() => hook.result.current.importFiles?.([{ file, apiPath: "/users/ann/Plan.md" }]));
    await waitFor(() => expect(onOpenDocsFile).toHaveBeenCalledWith("/users/ann/Plan.md"));
    expect(runImport).toHaveBeenCalledWith(file, "/users/ann/Plan.md");
    expect(show).toHaveBeenCalledWith("Importing “Plan.docx”…", { duration: Infinity });
  });

  it("explains a refusal and opens nothing", async () => {
    runImport.mockRejectedValue(new DocxSaveRefusedError("ole-container"));
    const { hook, onOpenDocsFile } = setup();
    act(() =>
      hook.result.current.importFiles?.([
        { file: new File(["x"], "Old.doc"), apiPath: "/users/ann/Old.md" },
      ]),
    );
    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledWith(
      "Could not import “Old.doc”. Nothing was created.",
      expect.objectContaining({ description: expect.stringMatching(/old Word file/) }),
    );
    expect(onOpenDocsFile).not.toHaveBeenCalled();
  });
});

describe("useImportWordFile with several files", () => {
  it("imports them one after the other, opens nothing and shows one summary", async () => {
    runImport
      .mockResolvedValueOnce({
        docPath: "/users/ann/A.md",
        report: { sourceName: "A.docx", lines: [] },
      })
      .mockResolvedValueOnce({
        docPath: "/users/ann/B.md",
        report: { sourceName: "B.docx", lines: [{ id: "fonts", count: 1, label: "font" }] },
      })
      .mockRejectedValueOnce(new DocxSaveRefusedError("not-a-zip"));
    const { hook, onOpenDocsFile } = setup();
    const entries = ["A", "B", "C"].map((name) => ({
      file: new File(["x"], `${name}.docx`),
      apiPath: `/users/ann/${name}.md`,
    }));
    act(() => hook.result.current.importFiles?.(entries));
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(3));
    expect(show).toHaveBeenCalledWith("Importing 1 of 3 files…", { duration: Infinity });
    expect(show).toHaveBeenCalledWith("Importing 3 of 3 files…", { duration: Infinity });

    const summary = render(<>{hook.result.current.dialogs}</>);
    await waitFor(() => {
      summary.rerender(<>{hook.result.current.dialogs}</>);
      expect(summary.getByText("Imported 2 of 3 files")).toBeTruthy();
    });
    expect(summary.getByText("Everything came across")).toBeTruthy();
    expect(summary.getByText("Some parts did not come across")).toBeTruthy();
    expect(summary.getByText("This file is not a Word document.")).toBeTruthy();
    expect(onOpenDocsFile).not.toHaveBeenCalled();

    fireEvent.click(summary.getByRole("button", { name: "B.docx" }));
    expect(onOpenDocsFile).toHaveBeenCalledWith("/users/ann/B.md");
  });
});

describe("WordFilePickerInput", () => {
  it("offers .docx files, several at once, and hands over the picked ones", () => {
    const onPick = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    const { getByTestId } = render(<WordFilePickerInput inputRef={ref} onPick={onPick} />);
    const input = getByTestId("docs-import-word-file-input") as HTMLInputElement;
    expect(input.accept).toContain(".docx");
    expect(input.multiple).toBe(true);
    expect(ref.current).toBe(input);
    const files = [new File(["x"], "Plan.docx"), new File(["y"], "Notes.docx")];
    fireEvent.change(input, { target: { files } });
    expect(onPick).toHaveBeenCalledWith(files);
  });
});
