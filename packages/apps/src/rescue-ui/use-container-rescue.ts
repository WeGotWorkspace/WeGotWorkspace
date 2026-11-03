import { useCallback, useMemo, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useParkedWrites } from "@/lib/offline/core/use-parked-writes";
import {
  groupParkedWrites,
  rescueParkedWrites,
  type RescueTarget,
} from "@/lib/offline/core/rescue-parked-writes";
import type { RescueAdapter, RescueContainer } from "@/rescue-ui/rescue-adapter";

/**
 * The shared rescue flow (#1825, #1565): the parked writes of the adapter's
 * domain, the containers they can go to, and what moving or discarding them
 * does. The parked store and the one-tab dialog lock are `useParkedWrites`.
 */
export function useContainerRescue<T, C extends RescueContainer>(
  username: string | null,
  adapter: RescueAdapter<T, C>,
) {
  const { domain, containers, canWrite, operations, afterSettle, labels: L } = adapter;
  const { writes, open, openDialog, closeDialog, take, claim } = useParkedWrites<T>(
    username,
    domain,
  );
  const [busy, setBusy] = useState(false);
  const { show, showError } = useAppToast();
  // A container a parked write came from just refused it, even before the cache knows.
  const writableContainers = useMemo(() => {
    const refused = new Set(writes.map((write) => write.containerId));
    return containers.filter((container) => canWrite(container) && !refused.has(container.id));
  }, [canWrite, containers, writes]);
  const waitingContainers = useMemo(() => groupParkedWrites(writes).length, [writes]);

  const settle = useCallback(
    (work: () => Promise<void>) => {
      setBusy(true);
      void work()
        .catch(() => showError(L.failed))
        .finally(async () => {
          setBusy(false);
          await afterSettle?.().catch(() => undefined);
        });
    },
    [L, afterSettle, showError],
  );

  const move = useCallback(
    (ids: string[], target: RescueTarget) =>
      settle(async () => {
        if (!username || !operations) return;
        const claimed = await claim(ids);
        try {
          const taken = claimed.writes;
          if (taken.length === 0) return;
          // Failed creates are parked again inside; created ones leave the claim one by one.
          const { containerId } = await rescueParkedWrites(
            username,
            domain,
            taken,
            target,
            operations,
            (write) => claimed.settle([write.id]),
          );
          const name =
            "newContainerName" in target
              ? target.newContainerName
              : (writableContainers.find((container) => container.id === containerId)?.name ?? "");
          show(L.moved(taken.length, name));
        } finally {
          claimed.release();
        }
      }),
    [L, claim, domain, operations, settle, show, username, writableContainers],
  );

  const discard = useCallback(
    (ids: string[]) =>
      settle(async () => {
        const taken = await take(ids);
        if (taken.length > 0) show(L.discarded(taken.length));
      }),
    [L, settle, show, take],
  );

  const openFromEntry = useCallback(() => {
    void openDialog().then((opened) => {
      if (!opened) show(L.openElsewhere);
    });
  }, [L, openDialog, show]);

  return {
    writes,
    open,
    busy,
    writableContainers,
    waitingContainers,
    move,
    discard,
    later: closeDialog,
    openFromEntry,
  };
}
