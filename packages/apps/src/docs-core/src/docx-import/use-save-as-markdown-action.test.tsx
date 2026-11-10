import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocxImportReportForDoc } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { setPendingDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report-store";
import { DocxSaveRefusedError } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { useSaveAsMarkdownAction } from "@/docs-core/src/docx-import/use-save-as-markdown-action";
import type { DriveFile } from "@/drive-core/src/drive-models";

const { show, dismiss, showError, online, runSave } = vi.hoisted(() => ({
  show: vi.fn(() => "toast-1"),
  dismiss: vi.fn(),
  showError: vi.fn(),
  online: { value: true },
  runSave: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, dismiss, showSuccess: vi.fn(), showError }),
}));
vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: online.value }),
}));
vi.mock("@/docs-core/src/docx-import/load-docx-converter", () => ({
  runSaveDocxAsMarkdown: runSave,
}));

const file = (title: string, extra: Partial<DriveFile> = {}): DriveFile =>
  ({
    id: title,
    title,
    kind: "doc",
    apiPath: `/users/ann/${title}`,
    ...extra,
  }) as DriveFile;

function setup(enabled = true) {
  const onOpenDocsFile = vi.fn();
  const hook = renderHook(() =>
    useSaveAsMarkdownAction({ enabled, onOpenDocsFile, dialogSurfaceClassName: "x" }),
  );
  return { hook, onOpenDocsFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  online.value = true;
});

describe("useSaveAsMarkdownAction", () => {
  it("offers the action only on Word files and Google links", () => {
    const { hook } = setup();
    const ids = (f: DriveFile) => hook.result.current.actionsFor(f).map((a) => a.label);
    expect(ids(file("Plan.docx"))).toEqual(["Save as Markdown"]);
    expect(ids(file("Plan.DOCX"))).toEqual(["Save as Markdown"]);
    expect(ids(file("Plan.gdoc"))).toEqual(["Save as Markdown"]);
    expect(ids(file("Plan.md"))).toEqual([]);
    expect(ids(file("Plan.doc"))).toEqual([]);
    expect(ids(file("Plan.docx", { kind: "folder" }))).toEqual([]);
    expect(ids(file("Plan.docx", { mayManageStructure: false }))).toEqual([]);
  });

  it("is hidden when disabled (guests, no create rights)", () => {
    const { hook } = setup(false);
    expect(hook.result.current.actionsFor(file("Plan.docx"))).toEqual([]);
  });

  it("is disabled with a reason while offline", () => {
    online.value = false;
    const { hook } = setup();
    const [action] = hook.result.current.actionsFor(file("Plan.docx"));
    expect(action.disabled).toBe(true);
    expect(action.onClick).toBeUndefined();
    expect(action.description).toMatch(/connection/i);
  });

  it("converts, hands over the report and opens the new Doc", async () => {
    runSave.mockResolvedValue({
      docPath: "/users/ann/Plan.md",
      report: { sourceName: "Plan.docx", lines: [{ id: "comments", count: 2, label: "comments" }] },
    });
    const { hook, onOpenDocsFile } = setup();
    act(() => hook.result.current.actionsFor(file("Plan.docx"))[0].onClick?.());
    await waitFor(() => expect(onOpenDocsFile).toHaveBeenCalledWith("/users/ann/Plan.md"));
    expect(runSave).toHaveBeenCalledWith("/users/ann/Plan.docx");
    expect(show).toHaveBeenCalledWith("Saving “Plan.docx” as Markdown…", { duration: Infinity });
    expect(dismiss).toHaveBeenCalledWith("toast-1");

    render(<DocxImportReportForDoc docPath="/users/ann/Plan.md" surfaceClassName="x" />);
    expect((await screen.findByRole("dialog")).textContent).toContain(
      "Some parts did not come across",
    );
    expect(screen.getByRole("dialog").textContent).toContain("2 comments");
  });

  it("explains a refusal and opens nothing", async () => {
    runSave.mockRejectedValue(new DocxSaveRefusedError("corrupt-zip"));
    const { hook, onOpenDocsFile } = setup();
    act(() => hook.result.current.actionsFor(file("Broken.docx"))[0].onClick?.());
    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledWith(
      "Could not save “Broken.docx” as Markdown. Nothing was created.",
      expect.objectContaining({ description: "This Word file is damaged and cannot be read." }),
    );
    expect(onOpenDocsFile).not.toHaveBeenCalled();
  });

  it("explains a Google link without converting", async () => {
    const { hook } = setup();
    render(<>{hook.result.current.dialogs}</>);
    act(() => hook.result.current.actionsFor(file("Notes.gdoc"))[0].onClick?.());
    hook.rerender();
    render(<>{hook.result.current.dialogs}</>);
    expect((await screen.findByRole("dialog")).textContent).toContain(
      "This file only links to Google Docs",
    );
    expect(screen.getByRole("dialog").textContent).toContain("File → Download → Microsoft Word");
    expect(runSave).not.toHaveBeenCalled();
  });
});

describe("DocxImportReportForDoc", () => {
  it("shows a report once, and nothing for an empty report", async () => {
    setPendingDocxImportReport("/users/ann/Clean.md", { sourceName: "Clean.docx", lines: [] });
    const { unmount } = render(
      <DocxImportReportForDoc docPath="/users/ann/Clean.md" surfaceClassName="x" />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    setPendingDocxImportReport("users/ann/Once.md", {
      sourceName: "Once.docx",
      lines: [{ id: "textBoxes", count: 1, label: "text box" }],
    });
    const first = render(
      <DocxImportReportForDoc docPath="/users/ann/Once.md" surfaceClassName="x" />,
    );
    expect((await screen.findByRole("dialog")).textContent).toContain("1 text box");
    first.unmount();
    render(<DocxImportReportForDoc docPath="/users/ann/Once.md" surfaceClassName="x" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
