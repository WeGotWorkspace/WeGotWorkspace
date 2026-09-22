# Mail Core Reuse Guide

`mail-core` exposes reusable building blocks for apps that need mail-style list/detail behavior.

## Reusable exports

- `MailWorkspace` (`src/mail-core/src/mail-workspace.tsx`)
- `useMailController` (`src/mail-core/src/use-mail-controller.tsx`) — thin composer over `useMailShell`, `useMailList`, and `useMailMutations`
- `MailAPIOperations`, `MailUIData`, `MailboxSummary`, and `MailMailboxLoader` (`src/mail-core/src/mail-types.ts`)
- View composition pieces:
  - `MailListPanel`
  - `MailDetailActionBar`
  - `MailDetailView`
  - `MailComposeView`
  - `MailAttachments`
  - `MultiSelectionView`

## Provider wiring

Implement `MailAPIOperations` for your backend and pass it into `MailWorkspace` (directly or via your own API hook).

This lets each app swap backend providers while reusing the same controller/UI behavior.

## Styling

Pane and detail styling lives under `.mail-workspace` in `mail-workspace.css`; TSX uses semantic BEM class names defined in that sheet (for example `mail-detail-view`, `mail-compose-view`). Portaled compose uses `.mail-compose-dialog-surface` in the same file. Storybook stories wrap components in `stories/mail-story-scope.tsx` inside `render` / harnesses so the same root classes apply as production.

## Storybook

| Story                                   | Purpose                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `Branding/Mail`                         | Full workspace chrome + branding knobs (`HtmlDetail` via Branding) |
| `Features/Mail/Panes/List`              | List column harness                                                |
| `Features/Mail/Panes/Detail`            | Detail view (plain + HTML iframe + attachments)                    |
| `Features/Mail/Panes/Detail action bar` | Toolbar variants                                                   |
| `Features/Mail/Panes/Compose`           | Compose dialog surface                                             |
| `Features/Mail/Panes/Attachments`       | Attachment grid                                                    |
| `Features/Mail/Panes/Multi selection`   | Batch selection surface                                            |
| `Features/Workspace`                    | Full shell (login → home → all apps, mock API in Storybook)        |
