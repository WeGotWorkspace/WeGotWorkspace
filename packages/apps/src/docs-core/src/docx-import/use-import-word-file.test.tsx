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
  const hook = renderHook(() => useImportWordFile({ enabled, onOpenDocsFile }));
  return { hook, onOpenDocsFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  online.value = true;
});

describe("useImportWordFile", () => {
  it("offers Import Word file, and nothing when disabled", () => {
    expect(setup().hook.result.current.menuItems.map((item) => item.label)).toEqual([
      "Import Word file",
    ]);
    const disabled = setup(false).hook.result.current;
    expect(disabled.menuItems).toEqual([]);
    expect(disabled.importFile).toBeUndefined();
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
    act(() => hook.result.current.importFile?.(file, "/users/ann/Plan.md"));
    await waitFor(() => expect(onOpenDocsFile).toHaveBeenCalledWith("/users/ann/Plan.md"));
    expect(runImport).toHaveBeenCalledWith(file, "/users/ann/Plan.md");
    expect(show).toHaveBeenCalledWith("Importing “Plan.docx”…", { duration: Infinity });
  });

  it("explains a refusal and opens nothing", async () => {
    runImport.mockRejectedValue(new DocxSaveRefusedError("ole-container"));
    const { hook, onOpenDocsFile } = setup();
    act(() => hook.result.current.importFile?.(new File(["x"], "Old.doc"), "/users/ann/Old.md"));
    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledWith(
      "Could not import “Old.doc”. Nothing was created.",
      expect.objectContaining({ description: expect.stringMatching(/old Word file/) }),
    );
    expect(onOpenDocsFile).not.toHaveBeenCalled();
  });
});

describe("WordFilePickerInput", () => {
  it("offers .docx files and hands over the picked one", () => {
    const onPick = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    const { getByTestId } = render(<WordFilePickerInput inputRef={ref} onPick={onPick} />);
    const input = getByTestId("docs-import-word-file-input") as HTMLInputElement;
    expect(input.accept).toContain(".docx");
    expect(ref.current).toBe(input);
    const file = new File(["x"], "Plan.docx");
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
  });
});
