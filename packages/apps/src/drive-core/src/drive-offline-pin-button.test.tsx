import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveOfflinePinButton } from "@/drive-core/src/drive-offline-pin-button";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { TooltipProvider } from "@/ui/tooltip";

function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

afterEach(cleanup);

const base = {
  labels: driveLabels,
  isAvailable: false,
  isPending: false,
  isPinning: false,
  canPin: true,
};

describe("DriveOfflinePinButton", () => {
  it("spins while the file downloads", () => {
    render(<DriveOfflinePinButton {...base} isPending />);
    expect(screen.getByRole("button", { name: driveLabels.offlineDownloading })).toBeTruthy();
  });

  it("shows a failed download as failed, not as spinning, and retries on click", () => {
    const onPin = vi.fn();
    render(<DriveOfflinePinButton {...base} isPending isFailed onPin={onPin} />);
    expect(screen.queryByRole("button", { name: driveLabels.offlineDownloading })).toBeNull();
    const retry = screen.getByRole("button", { name: driveLabels.offlineDownloadFailed });
    fireEvent.click(retry);
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it("spins again while the manual retry runs", () => {
    render(<DriveOfflinePinButton {...base} isFailed isPinning />);
    expect(screen.getByRole("button", { name: driveLabels.offlineDownloading })).toBeTruthy();
  });

  it("shows nothing once the file is available", () => {
    const { container } = render(<DriveOfflinePinButton {...base} isAvailable isFailed />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();
  });
});
