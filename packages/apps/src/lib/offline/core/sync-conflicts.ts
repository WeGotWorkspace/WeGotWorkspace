/** Listener invoked with the ids that hit an unresolved sync conflict. */
export type SyncConflictListener<TId> = (ids: TId[]) => void;

export type SyncConflictChannel<TId> = {
  /** Register (or clear, with `undefined`) the active conflict listener. */
  setListener: (next: SyncConflictListener<TId> | undefined) => void;
  /** Notify the listener. An empty list clears, so a resolved conflict can turn the notice off. */
  report: (ids: TId[]) => void;
};

/**
 * Generic single-listener conflict channel. A domain creates one instance and
 * wires `report` from its flush path and `setListener` from its UI.
 */
export function createSyncConflictChannel<TId>(): SyncConflictChannel<TId> {
  let listener: SyncConflictListener<TId> | undefined;

  return {
    setListener(next) {
      listener = next;
    },
    report(ids) {
      listener?.(ids);
    },
  };
}
