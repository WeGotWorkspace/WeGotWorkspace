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
    expect(trigger.textContent).toContain("Administrators (Team)");

    fireEvent.click(trigger);
    expect(screen.queryByRole("option")).toBeNull();
  });
  describe("team admin rule (#2368)", () => {
    const mixed = [
      { slug: "design", displayName: "Design", isTeamAdmin: true },
      { slug: "sales", displayName: "Sales", isTeamAdmin: false },
    ];

    it("lists only the Teams the viewer is team admin of", () => {
      render(
        <OwnerScopeField
          id="owner-scope"
          value={PERSONAL_SCOPE_VALUE}
          onValueChange={vi.fn()}
          groups={mixed}
          personalOwnerLabel="Demo User"
        />,
      );

      fireEvent.click(screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label }));
      expect(screen.getByRole("option", { name: "Design (Team)" })).toBeTruthy();
      expect(screen.queryByRole("option", { name: "Sales (Team)" })).toBeNull();
      expect(screen.queryByText(defaultOwnerScopeLabels.noTeamAdminHint!)).toBeNull();
    });

    it("keeps the Team the collection is in, even without the role", () => {
      render(
        <OwnerScopeField
          id="owner-scope"
          value="sales"
          onValueChange={vi.fn()}
          groups={mixed}
          personalOwnerLabel="Demo User"
        />,
      );

      const trigger = screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label });
      expect(trigger.textContent).toContain("Sales (Team)");
      fireEvent.click(trigger);
      expect(screen.getAllByRole("option", { name: "Sales (Team)" }).length).toBeGreaterThan(0);
    });

    it("explains why no Team is offered when the viewer is in Teams but admin of none", () => {
      render(
        <OwnerScopeField
          id="owner-scope"
          value={PERSONAL_SCOPE_VALUE}
          onValueChange={vi.fn()}
          groups={mixed.map((group) => ({ ...group, isTeamAdmin: false }))}
          personalOwnerLabel="Demo User"
        />,
      );

      expect(screen.getByText(defaultOwnerScopeLabels.noTeamAdminHint!)).toBeTruthy();
      fireEvent.click(screen.getByRole("combobox", { name: defaultOwnerScopeLabels.label }));
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    it("says nothing when the viewer is in no Team", () => {
      render(
        <OwnerScopeField
          id="owner-scope"
          value={PERSONAL_SCOPE_VALUE}
          onValueChange={vi.fn()}
          groups={[]}
          personalOwnerLabel="Demo User"
        />,
      );

      expect(screen.queryByText(defaultOwnerScopeLabels.noTeamAdminHint!)).toBeNull();
    });
  });
});
