---
name: storybook
description: Storybook standards for packages/apps — offline-first coverage, CSF3 stories, mock vs live tiers, argTypes knobs, cssprops, fixtures, and a11y. Use when creating or updating .stories.tsx files.
paths:
  - "packages/apps/**/*.stories.*"
  - "packages/apps/.storybook/**"
---

# Storybook

Config: `packages/apps/.storybook/main.ts`, `preview.ts`.

Addons in use: `@storybook/addon-a11y`, `@ljcl/storybook-addon-cssprops`, `@storybook/addon-docs`, `@chromatic-com/storybook`.

## Quick decision matrix

| Task | Read |
|------|------|
| Offline-first / mock vs live / 100% coverage | [offline-first.md](offline-first.md) (canonical) |
| Variant matrix / new export checklist | [coverage.md](coverage.md) |
| CSS variable knobs | [cssprops.md](cssprops.md) |
| Harnesses / fixtures / router | [fixtures.md](fixtures.md) |
| Accessibility testing | [a11y-testing.md](a11y-testing.md) → [accessibility](../accessibility/SKILL.md) |
| Chromatic / visual regression (opt-in) | [chromatic.md](chromatic.md) |

## CSF3 baseline

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof Component> = {
  title: "UI/Primitives/ComponentName",
  component: Component,
  argTypes: { /* knobs */ },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const Default: Story = {
  args: { /* … */ },
};
```

Reference: `packages/apps/src/button/stories/button.stories.tsx`.

## Run

- Dev: `pnpm dev` or `pnpm dev:storybook` in monorepo root / `packages/apps`
- URL: http://127.0.0.1:6006

## Title namespaces

Top-level groups (CSF `title` only — do not move story files to match):

- `Foundations/` — short docs for Colors, Typography, Spacing (CSS tokens; live knobs stay in Themes)
- `Themes/` — designer catalog (workspace chrome + auth/installer; accents / cream/ink / icons)
- `UI/Primitives/` — context-agnostic controls (Button, Input, Dialog, Menu Item, …)
- `UI/Patterns/` — compositions with no product noun (Detail View Header, Action Bar, Chat, …)
- `Layout/` — page frame (App Sidebar, Shell Header, Brand Lockup, …)
- `Features/{App}/` — product panes/components (Mail, Notes, Drive, Docs, Calendar, Contacts, Tasks, Meet, Admin, Settings)
- `Features/Workspace/` — WeGotWorkspace mock shell; live API under `Features/Workspace/Live/…`

Sidebar order is set explicitly in `packages/apps/.storybook/preview.ts` (`parameters.options.storySort`): **Foundations → Themes → UI → Layout → Features**. Nested stories stay alphabetical within each group.

No top-level `Shared/` or `Forms/`. Rule when unsure: product noun → Features; reusable without a product word → UI or Layout; page frame / routing chrome → Layout.

**Policy vs CI:** [.agents/POLICY.md](../../POLICY.md). **Done verification:** [developer/done-checklist.md](../developer/done-checklist.md) (UI section).
