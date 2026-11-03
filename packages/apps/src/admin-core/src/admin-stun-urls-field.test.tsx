import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminStunUrlsField } from "@/admin-core/src/admin-stun-urls-field";
import { DEFAULT_PUBLIC_STUN_URLS_CSV } from "@/lib/rtc/default-stun";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider delayDuration={0}>
      <AdminStunUrlsField value={value} onChange={setValue} />
      <output data-testid="stored">{value}</output>
    </TooltipProvider>
  );
}

function stored(): string {
  return screen.getByTestId("stored").textContent ?? "";
}

describe("AdminStunUrlsField", () => {
  it("marks the default and says whose server it is", () => {
    render(<Harness initial={DEFAULT_PUBLIC_STUN_URLS_CSV} />);
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText(/Provided by Nextcloud/)).toBeTruthy();
    expect(screen.queryByText("Restore default")).toBeNull();
  });

  it("shows restore as a danger action", () => {
    render(<Harness initial="stun:own.example.test:3478" />);
    expect(screen.getByLabelText("Restore default").className).toContain("button--severity-danger");
  });

  it("restores the default only after confirming", () => {
    render(<Harness initial="stun:own.example.test:3478" />);
    fireEvent.click(screen.getByLabelText("Restore default"));
    expect(screen.getByText("Restore the default STUN server?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stored()).toBe("stun:own.example.test:3478");

    fireEvent.click(screen.getByLabelText("Restore default"));
    const confirm = screen
      .getAllByRole("button", { name: "Restore default" })
      .find((button) => button.closest("[role='alertdialog']"));
    fireEvent.click(confirm!);
    expect(stored()).toBe(DEFAULT_PUBLIC_STUN_URLS_CSV);
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("keeps one field per url", () => {
    render(<Harness initial="stun:a.example.test,stun:b.example.test" />);
    expect((screen.getByLabelText("STUN URL 2") as HTMLInputElement).value).toBe(
      "stun:b.example.test",
    );
  });

  it("warns when no STUN server is set", () => {
    render(<Harness initial="" />);
    expect(screen.getByText(/only work between people on the same network/)).toBeTruthy();
  });
});
