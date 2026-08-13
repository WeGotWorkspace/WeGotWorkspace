# Issue drafts (umbrella) — filed 2026-08-13

All immediately-fileable issues were created on 2026-08-13 (the CI token can
create issues but not edit or comment on them, so post-filing updates to
issue bodies require a maintainer):

| Issue | Kind | Title | Spec folder |
|-------|------|-------|-------------|
| #435 | Epic | JMAP transport envelope for contacts, blobs, files, and mail | this folder (`Source:` header) |
| #436 | Chore | refactor(api): decouple JMAP envelope routes and capabilities from calendars | this folder, chunk P (no spec folder needed) |
| #437 | Task | feat(api): JMAP envelope methods for contacts (RFC 9610) | [../437-jmap-envelope-contacts/](../437-jmap-envelope-contacts/spec.md) |
| #438 | Task | feat(api): real JMAP blob upload/download (RFC 8620 §6) | [../438-jmap-blobs/](../438-jmap-blobs/spec.md) |
| #439 | Task | docs(api): FileNode node-identity index design (JMAP filenode) | [../000-jmap-envelope-filenode/](../000-jmap-envelope-filenode/spec.md) |
| #440 | Task | docs(api): JMAP Mail over IMAP — state model and build/defer decision | [../000-jmap-envelope-mail/](../000-jmap-envelope-mail/spec.md) |

**Deliberately not filed yet** (gated):

- Files envelope build — after #439 lands; draft body in [../000-jmap-envelope-filenode/issue-draft.md](../000-jmap-envelope-filenode/issue-draft.md)
- Mail read-only (M1) — only if #440 concludes "build"; draft body in [../000-jmap-envelope-mail/issue-draft.md](../000-jmap-envelope-mail/issue-draft.md)
- Mail writes + submission (M2) — after M1; draft body in the same file

**Epic parenting:** #435 follows the #401 precedent — an engineering epic with
a "Supports Goals" table (#383 contacts, #379 drive, #400/#398 mail, #385/#402
calendars) instead of a single parent Goal; not on the Product Project.

**Epic body updated 2026-08-13** (maintainer edit): the children list in #435
now links #436–#440; the umbrella `Source:` body-hash reflects the edited
body (`7773425c`).

**Filed later the same day:** #445 — feat(apps): contacts app on the JMAP
envelope (apps-side migration; depends on #437, blob seam swaps at #438) —
added to the Epic children by the maintainer.
