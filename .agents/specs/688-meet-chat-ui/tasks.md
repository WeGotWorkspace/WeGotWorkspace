# Engineering tasks — Meet chat workspace frontend

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id                  | owner / agent        | skill                                 | key paths                                                                                    | verify command                                | status  |
| ------------------- | -------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `file-issues-spec`  | builder (this phase) | developer, plan-feature, git-workflow | `.agents/specs/688-meet-chat-ui/`                                                            | `gh issue view` parents; body-hash `70ee9f78` | done    |
| `types-fixtures`    | builder (this phase) | workspace                             | `meet-types.ts`, `meet-bootstrap.ts`, `meet-chat-operations.ts`, partition + preview helpers | targeted Vitest                               | done    |
| `shell-channels`    | builder (this phase) | workspace                             | `MeetCallWorkspace` rename; `MeetWorkspace`; channel dialog; `Apps/Meet` story               | targeted Vitest + stories compile             | done    |
| `chat-primitives`   | later                | apps-ui, storybook                    | `packages/apps/src/chat-ui/`                                                                 | Vitest + `Shared/Chat/*` stories              | done    |
| `link-previews`     | later                | apps-ui, storybook                    | `ChatLinkPreview`; unfurl map attach                                                         | preview stories                               | done    |
| `chat-threads`      | later                | apps-ui, workspace                    | `ChatThreadPanel`; panel vs SideDrawer                                                       | thread stories                                | done    |
| `call-stage-guest`  | later                | workspace, meet                       | `MeetCallStage`; guest stripped stories                                                      | call + guest stories                          | done    |
| `compose-workspace` | later                | workspace, storybook                  | wire `MeetWorkspace`; keep `MeetApp` on `MeetCallWorkspace`                                  | Storybook coverage                            | done    |
| `docs-verify`       | later                | testing, document                     | `workspace-shells.md`; meet skill                                                            | apps-done-gate + verify-issue #688            | done    |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Task #688** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Branch `feat/meet-chat-ui` closes **#688**, not Goal #686. Goal Status stays **Identified** until product Adopted / Fulfilled.
- Worktree: `/Users/woutervroege/Sites/sabre-installer-meet-chat-ui` (port offset 1 → dev :5174).
- Chunk V (2026-09-01): Meet typecheck + Storybook coverage 180/180 green. `pnpm test:apps-done-gate` still red on pre-existing calendar date assertions (`calendar-app-route-click` Today === 2026-09-01; Calendar "Search No Match" expects Aug 2025). Not Meet scope.
