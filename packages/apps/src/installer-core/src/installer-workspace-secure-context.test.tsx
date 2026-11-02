import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { installerCopy } from "@/installer-core/src/installer-copy";
import { InstallerWorkspace } from "@/installer-core/src/installer-workspace";
import { createInstallerAppBootstrap } from "@/lib/api/mock/installer-bootstrap";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function renderInstaller(secureContext: boolean) {
  const { data, operations } = createInstallerAppBootstrap();
  const welcomeNext = vi.spyOn(operations!, "welcomeNext");
  render(<InstallerWorkspace data={data} operations={operations} secureContext={secureContext} />);
  fireEvent.click(screen.getByRole("button", { name: installerCopy.getStarted }));
  return { welcomeNext };
}

describe("InstallerWorkspace secure context", () => {
  it("over http, warns and waits for the admin before setup goes on", async () => {
    const { welcomeNext } = renderInstaller(false);

    expect(screen.getByRole("heading", { name: installerCopy.notSecureTitle })).toBeTruthy();
    for (const loss of installerCopy.notSecureLosses) {
      expect(screen.getByText(loss)).toBeTruthy();
    }
    expect(screen.getByText(installerCopy.notSecureFix)).toBeTruthy();
    expect(document.title).toContain("Not secure");
    expect(welcomeNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: installerCopy.notSecureContinue }));

    expect(await screen.findByRole("heading", { name: installerCopy.databaseTitle })).toBeTruthy();
    expect(welcomeNext).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: installerCopy.notSecureTitle })).toBeNull();
  });

  it("on https or localhost, goes straight on with no warning", async () => {
    const { welcomeNext } = renderInstaller(true);

    expect(await screen.findByRole("heading", { name: installerCopy.databaseTitle })).toBeTruthy();
    expect(welcomeNext).toHaveBeenCalledOnce();
    expect(screen.queryByText(installerCopy.notSecureLead)).toBeNull();
  });
});
