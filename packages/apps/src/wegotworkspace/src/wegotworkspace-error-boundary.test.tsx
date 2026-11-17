import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeGotWorkspaceErrorBoundary } from "@/wegotworkspace/src/wegotworkspace-error-boundary";

const record = vi.fn(async (_error: unknown, _source: string) => undefined);
vi.mock("@/lib/diagnostics/error-diagnostics-recorder", () => ({
  recordUnexpectedError: (error: unknown, source: string) => record(error, source),
}));

afterEach(() => {
  cleanup();
  record.mockClear();
  vi.restoreAllMocks();
});

function Crash(): never {
  throw new TypeError("shell crashed");
}

describe("WeGotWorkspaceErrorBoundary", () => {
  it("records a render error and offers a reload and the diagnostics page", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <WeGotWorkspaceErrorBoundary>
        <Crash />
      </WeGotWorkspaceErrorBoundary>,
    );

    expect(record).toHaveBeenCalledOnce();
    const [error, source] = record.mock.calls[0] ?? [];
    expect((error as Error).message).toBe("shell crashed");
    expect(source).toBe("render");
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings → Diagnostics" }).getAttribute("href")).toBe(
      "/settings/diagnostics",
    );
  });

  it("renders its children when nothing fails", () => {
    render(
      <WeGotWorkspaceErrorBoundary>
        <p>App</p>
      </WeGotWorkspaceErrorBoundary>,
    );

    expect(screen.getByText("App")).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });
});
