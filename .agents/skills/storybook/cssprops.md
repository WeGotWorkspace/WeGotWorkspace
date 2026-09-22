# CSS props addon

Addon: `@ljcl/storybook-addon-cssprops` (registered in `.storybook/main.ts`).

## When to use

Document **CSS custom properties** that parents set for theming — especially primitive and workspace tokens consumed via `var(--…)`.

Reference: `packages/apps/src/app-switch-button/stories/app-switch-button.stories.tsx`.

## Pattern

```tsx
const meta = {
  title: "UI/Primitives/Example",
  component: Example,
  parameters: {
    cssprops: {
      "--example-token": {
        value: "#949dad",
        description: "Token used by .example-root",
      },
    },
  },
};
```

## Rules

- Document tokens that **callers** or **workspace roots** are expected to override — not every internal CSS variable.
- Match token names to real variables in co-located `*.css` files.
- Prefer cssprops for design review; production theming still lives in workspace CSS ([apps-ui](../apps-ui/SKILL.md)).

## Do not

- Use cssprops as a substitute for proper workspace-scoped stylesheets in product code.
- Duplicate `argTypes` for props that are already React knobs — cssprops are for CSS variables only.
