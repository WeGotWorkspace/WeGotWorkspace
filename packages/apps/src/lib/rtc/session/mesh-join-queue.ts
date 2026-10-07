/**
 * One join at a time per room. React StrictMode starts a second join while the
 * first request is still open; collab's join then deletes the newer peer for
 * the same browser, and the live precheck comes back `unknown_peer`.
 */
const meshJoinTails = new Map<string, Promise<unknown>>();

export function enqueueMeshJoin<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = meshJoinTails.get(key) ?? Promise.resolve();
  const current = previous.then(run, run);
  meshJoinTails.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}
