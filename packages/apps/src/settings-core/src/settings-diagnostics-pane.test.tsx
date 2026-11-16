import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorDiagnosticEntry } from "@/lib/diagnostics/error-diagnostics-store";
import { SettingsDiagnosticsPane } from "@/settings-core/src/settings-diagnostics-pane";

const showSuccess = vi.fn();
vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess, showError: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  showSuccess.mockClear();
});

const entry: ErrorDiagnosticEntry = {
  id: 1,
  time: "2026-11-16T10:42:00.000Z",
  source: "error",
  name: "TypeError",
  message: "items.map is not a function",
  stack: "TypeError: items.map is not a function\n    at List (/assets/drive-abc.js:10:5)",
  app: "drive",
  route: "/drive/folder",
  build: "0.1.124",
  userAgent: "test-agent",
  count: 1,
};

describe("SettingsDiagnosticsPane", () => {
  it("shows an empty state and nothing to copy when no error is recorded", async () => {
    render(<SettingsDiagnosticsPane load={async () => []} copyText={vi.fn()} />);

    expect(await screen.findByText("No errors recorded on this device.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Copy diagnostics" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("copies the recorded errors as plain text and shows what was copied", async () => {
    const copyText = vi.fn(async (_text: string) => true);
    render(
      <SettingsDiagnosticsPane
        load={async () => [entry]}
        copyText={copyText}
        now={() => new Date("2026-11-16T10:45:00.000Z")}
      />,
    );

    expect(await screen.findByText(/^1 error kept on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    await waitFor(() => expect(copyText).toHaveBeenCalledOnce());
    const copied = copyText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("WeGotWorkspace diagnostics");
    expect(copied).toContain("Copied: 2026-11-16T10:45:00.000Z");
    expect(copied).toContain("Message: TypeError: items.map is not a function");
    expect(showSuccess).toHaveBeenCalledWith("Diagnostics copied");
    const preview = screen.getByRole("textbox", { name: "Diagnostics text" });
    expect((preview as HTMLTextAreaElement).value).toBe(copied);
  });

  it("selects the text and says so inline when the browser blocks copying", async () => {
    render(<SettingsDiagnosticsPane load={async () => [entry]} copyText={async () => false} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy diagnostics" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This browser blocked copying");
    expect(showSuccess).not.toHaveBeenCalled();
    const preview = screen.getByRole("textbox", {
      name: "Diagnostics text",
    }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(preview);
    expect(preview.selectionEnd - preview.selectionStart).toBe(preview.value.length);
  });
});
