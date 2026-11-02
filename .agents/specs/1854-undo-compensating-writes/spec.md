Source: #1854 (body-hash: 0d0ae622)
Goal: WeGotWorkspace/Product#149

# Undo as a compensating write

## Goal

Every undoable action in `packages/apps` either goes to the server at once and is undone by a compensating write (reversible), or is explicitly marked irreversible and keeps the 2.5 s grace period with Undo-as-cancel. `useQueuedMutation` enforces the choice in its argument type. With live push (#1659), the other person then sees a change within seconds, and sees an Undo as a second change.

## Non-goals

- New trash/restore APIs for notes, tasks, contacts or calendar events. Their deletes stay deferred.
- Making rename, Docs move, or calendar "this instance"/"this and future" deletes undoable.
- Changing toast copy, toast duration, or the grace period length.

## Affected packages

- packages/apps

## Contract

```ts
type ReversibleWriteArgs = {
  key; toastMessage; undo /* screen rollback */; onError?; undoToastMessage?; icon?;
  execute(signal, markCompleted): Promise<void>;
  revert(completed: ReadonlySet<string> | null): Promise<void>; // null = whole write
};
type IrreversibleWriteArgs = { …same base; irreversible: true; execute(signal): Promise<void> };
```

- Reversible: `execute` starts at once. Undo calls `undo` (screen) and, once `execute` has settled, `revert` with the keys the batch marked, or `null` when it resolved without marking. Undo never aborts the request: an aborted fetch may still land, and then nothing would revert it.
- A reversible write that fails: screen rollback (`onError ?? undo`), the error toast, and a revert of any items already marked (a batch lands whole or not at all).
- Irreversible: unchanged from today (timer, page-exit flush #1794, Undo aborts).
- Undo stays available for `delayMs + 3500` ms in both modes, as today.

## Technical constraints

- Reverts are **deltas**: send only the field the action changed (`fields: ["starred"]`, the opposite tag delta, the opposite archive status, the old parent). Never send a whole snapshot: it would wipe a concurrent edit by someone else.
- ETag / `If-Match`: a revert must not reuse the ETag captured before the write (that is a guaranteed 412). Reverts go through the hybrid operations, which take the cached ETag, or through calls that already re-fetch (`patchGroupWithFreshEtag`).
- Offline: writes go through the per-app outbox. A revert of a row that is still queued coalesces with it (`enqueueCoalescedOutboxUpdate`) or replaces it in place (notes archive ↔ restore). A row that the flush is sending at that moment is sent again, because the flush settles with `settleSentOutboxMutation`, which keeps a changed row.
- Grandfathered hooks (`useContactsController`, `useCalendarController`, and the other rows in `tools/hook-size-baseline.tsv`) must not grow; reverts live in helpers outside the hook bodies.

## Edge cases

- Undo before the write settled: the revert waits for `execute`; a create's revert needs the created id, which only exists after it settled.
- Undo after the write failed: nothing more is sent (the failure already rolled back).
- The same key queued again (star, unstar, star): the newer write takes over the toast; the older one has already been sent and keeps its course.
- A revert that fails shows the generic mutation error; the next sync shows the server state.
- Page closed after Undo but before `execute` settled: the revert is lost. Accepted: the window is one request long.
