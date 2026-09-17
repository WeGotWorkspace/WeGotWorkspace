import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InstallFirstRunAccount } from "@/install-core/src/install-first-run-account";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/install" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

describe("InstallFirstRunAccount", () => {
  it("asks only for username and password", () => {
    render(<InstallFirstRunAccount initialUsername="jane" initialPassword="hunter2hunter" />);
    expect(screen.getByRole("heading", { name: "Your account." })).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByText(/You'll sign in as/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use MySQL / MariaDB" })).toBeNull();
    expect(screen.queryByRole("button", { name: "SQLite" })).toBeNull();
  });

  it("keeps an email-shaped value in the username field", () => {
    render(<InstallFirstRunAccount />);
    const username = screen.getByLabelText("Username");
    expect(username.getAttribute("type")).not.toBe("email");
    fireEvent.change(username, { target: { value: "jane@example.com" } });
    expect((username as HTMLInputElement).value).toBe("jane@example.com");
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("submits account values without a confirm-password field", () => {
    const onCreateWorkspace = vi.fn();
    render(
      <InstallFirstRunAccount
        initialUsername="jane"
        initialPassword="hunter2hunter"
        onCreateWorkspace={onCreateWorkspace}
      />,
    );
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(onCreateWorkspace).toHaveBeenCalledWith({
      username: "jane",
      password: "hunter2hunter",
    });
  });

  it("keeps Database in the progress dots after that step", () => {
    render(<InstallFirstRunAccount initialUsername="jane" />);
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Database, done")).toBeTruthy();
    expect(screen.getByText("Your account, current")).toBeTruthy();
  });

  it("omits the Database dot when env already supplied the database", () => {
    render(<InstallFirstRunAccount initialUsername="jane" includeDatabaseStep={false} />);
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/^Database/)).toBeNull();
    expect(screen.getByText("Your account, current")).toBeTruthy();
  });
});
