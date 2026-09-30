/**
 * Class name fragments for panes rendered under `.settings-workspace`.
 * Paired with `settings-workspace.css` (descendant selectors on that root).
 */
export const settingsWorkspacePaneClasses = {
  formTextField: { itemClassName: "settings-form-field" },
  saveActionRow: "settings-form-actions",
  grid2: "settings-grid-2",
  stack: "settings-pane-stack",
} as const;
