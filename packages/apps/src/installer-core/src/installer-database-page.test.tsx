import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InstallerDatabasePage } from "@/installer-core/src/installer-database-page";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/install" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

describe("InstallerDatabasePage", () => {
  it("defaults to MySQL with connection fields", () => {
    render(<InstallerDatabasePage />);
    expect(screen.getByRole("heading", { name: "Your database." })).toBeTruthy();
    expect(document.querySelector(".installer__hero-your")?.textContent).toBe("Your");
    expect(document.querySelector(".installer__hero-noun")?.textContent).toBe("database");
    const engines = within(screen.getByRole("group", { name: "Type" })).getAllByRole("button");
    expect(engines[0].getAttribute("aria-label")).toBe("MySQL / MariaDB");
    expect(engines[0].getAttribute("aria-pressed")).toBe("true");
    expect(engines[1].getAttribute("aria-label")).toBe("SQLite");
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.getByLabelText("Port")).toBeTruthy();
    expect(screen.getByLabelText("Database")).toBeTruthy();
    expect(screen.getByLabelText("User")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(document.querySelector(".installer__mysql-row--host-port")).toBeTruthy();
    expect(document.querySelector(".installer__mysql-host")).toBeTruthy();
    const panels = document.querySelectorAll(".installer__engine-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].classList.contains("installer__engine-panel--hidden")).toBe(false);
    expect(panels[1].classList.contains("installer__engine-panel--hidden")).toBe(true);
    expect(panels[1].getAttribute("aria-hidden")).toBe("true");
    expect(panels[1].textContent).toContain("Uses the default SQLite file.");
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Database, current")).toBeTruthy();
  });

  it("shows SQLite hint when that engine is chosen", () => {
    render(<InstallerDatabasePage />);
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(screen.getByText("Uses the default SQLite file.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Host" })).toBeNull();
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const panels = document.querySelectorAll(".installer__engine-panel");
    expect(panels[0].classList.contains("installer__engine-panel--hidden")).toBe(true);
    expect(panels[1].classList.contains("installer__engine-panel--hidden")).toBe(false);
  });

  it("shows a connection error above Continue", () => {
    render(
      <InstallerDatabasePage connectionError="Could not reach MySQL at 127.0.0.1:3306. Check the host and port, or use SQLite." />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not reach MySQL");
  });

  it("submits sqlite without credentials", () => {
    const onContinue = vi.fn();
    render(<InstallerDatabasePage initialEngine="sqlite" onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({ engine: "sqlite" });
  });

  it("keeps MySQL defaults when the API omits connection fields", () => {
    render(
      <InstallerDatabasePage
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
    render(<InstallerDatabasePage onContinue={onContinue} />);
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
