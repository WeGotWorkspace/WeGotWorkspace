import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultOwnerScopeLabels,
  OwnerScopeField,
  PERSONAL_SCOPE_VALUE,
} from "@/ui/owner-scope-field";

const groups = [
  { slug: "administrators", displayName: "Administrators" },
  { slug: "team", displayName: "Team" },
];

describe("OwnerScopeField", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the Owner select with Only Me and group options", () => {
    render(
      <OwnerScopeField
        id="owner-scope"
        value={PERSONAL_SCOPE_VALUE}
        onValueChange={vi.fn()}
        groups={groups}
        personalOwnerLabel="Demo User"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label });
    expect(trigger.textContent).toContain("Only Me");

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Only Me" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: defaultOwnerScopeLabels.group("Administrators") }),
    ).toBeTruthy();
  });

  it("notifies when a group is selected", () => {
    const onValueChange = vi.fn();
    render(
      <OwnerScopeField
        id="owner-scope"
        value={PERSONAL_SCOPE_VALUE}
        onValueChange={onValueChange}
        groups={groups}
        personalOwnerLabel="Demo User"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label }));
    fireEvent.click(
      screen.getByRole("option", { name: defaultOwnerScopeLabels.group("Administrators") }),
    );

    expect(onValueChange).toHaveBeenCalledWith("administrators");
  });

  it("renders the same dropdown disabled without opening", () => {
    render(
      <OwnerScopeField
        id="owner-scope"
        value="administrators"
        onValueChange={vi.fn()}
        groups={groups}
        personalOwnerLabel="Demo User"
        disabled
      />,
    );

    const trigger = screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label });
    expect(trigger).toHaveProperty("disabled", true);
    expect(trigger.textContent).toContain("Administrators (Group)");

    fireEvent.click(trigger);
    expect(screen.queryByRole("option")).toBeNull();
  });
});
