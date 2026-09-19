import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InstallFirstRunDatabase } from "@/install-core/src/install-first-run-database";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/install" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

describe("InstallFirstRunDatabase", () => {
  it("defaults to MySQL with connection fields", () => {
    render(<InstallFirstRunDatabase />);
    expect(screen.getByRole("heading", { name: "Your database." })).toBeTruthy();
    expect(document.querySelector(".install-first-run__hero-your")?.textContent).toBe("Your");
    expect(document.querySelector(".install-first-run__hero-noun")?.textContent).toBe("database");
    const engines = within(screen.getByRole("group", { name: "Type" })).getAllByRole("button");
    expect(engines[0].getAttribute("aria-label")).toBe("MySQL / MariaDB");
    expect(engines[0].getAttribute("aria-pressed")).toBe("true");
    expect(engines[1].getAttribute("aria-label")).toBe("SQLite");
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.getByLabelText("Port")).toBeTruthy();
    expect(screen.getByLabelText("Database")).toBeTruthy();
    expect(screen.getByLabelText("User")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(document.querySelector(".install-first-run__mysql-row--host-port")).toBeTruthy();
    expect(document.querySelector(".install-first-run__mysql-host")).toBeTruthy();
    const panels = document.querySelectorAll(".install-first-run__engine-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].classList.contains("install-first-run__engine-panel--hidden")).toBe(false);
    expect(panels[1].classList.contains("install-first-run__engine-panel--hidden")).toBe(true);
    expect(panels[1].getAttribute("aria-hidden")).toBe("true");
    expect(panels[1].textContent).toContain("Uses the default SQLite file.");
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Database, current")).toBeTruthy();
  });

  it("shows SQLite hint when that engine is chosen", () => {
    render(<InstallFirstRunDatabase />);
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(screen.getByText("Uses the default SQLite file.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Host" })).toBeNull();
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const panels = document.querySelectorAll(".install-first-run__engine-panel");
    expect(panels[0].classList.contains("install-first-run__engine-panel--hidden")).toBe(true);
    expect(panels[1].classList.contains("install-first-run__engine-panel--hidden")).toBe(false);
  });

  it("submits sqlite without credentials", () => {
    const onContinue = vi.fn();
    render(<InstallFirstRunDatabase initialEngine="sqlite" onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({ engine: "sqlite" });
  });

  it("keeps MySQL defaults when the API omits connection fields", () => {
    render(
      <InstallFirstRunDatabase
        initialMysql={{
          host: undefined,
          port: undefined,
          database: undefined,
          username: undefined,
        }}
      />,
    );
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("127.0.0.1");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("3306");
    expect((screen.getByLabelText("Database") as HTMLInputElement).value).toBe("wgw");
    expect((screen.getByLabelText("User") as HTMLInputElement).value).toBe("wgw");
  });

  it("submits mysql credentials by default", () => {
    const onContinue = vi.fn();
    render(<InstallFirstRunDatabase onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({
      engine: "mysql",
      mysql: {
        host: "127.0.0.1",
        port: "3306",
        database: "wgw",
        username: "wgw",
        password: "",
      },
    });
  });
});
