/** Send the state vector this long after the last update this session broadcast. */
export const MESH_STATE_CHECK_QUIET_MS = 1_500;

/** During long typing, check at least this often. */
export const MESH_STATE_CHECK_MAX_DELAY_MS = 5_000;

/**
 * Anti-entropy for the collab mesh. A peer that misses one of our updates has
 * nothing that shows the gap: Yjs holds our later updates as pending, and when
 * the lost one was the last, nothing arrives at all. Once our updates go quiet
 * we broadcast a sync step 1; a peer whose state vector is behind pulls the
 * missing part back (see `pullBack` in `handleGuardedSyncMessage`).
 *
 * Only sent updates schedule a check. A step 1 or step 2 never does, so a
 * check cannot set off another one.
 */
export class DocsCollabMeshStateCheck {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** When the first update of the current burst was sent. */
  private burstStartedAt: number | null = null;

  constructor(
    private readonly sendStateVector: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  noteUpdateSent(): void {
    const now = this.now();
    this.burstStartedAt ??= now;
    const dueAt = Math.min(
      now + MESH_STATE_CHECK_QUIET_MS,
      this.burstStartedAt + MESH_STATE_CHECK_MAX_DELAY_MS,
    );
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), Math.max(0, dueAt - now));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.burstStartedAt = null;
  }

  private fire(): void {
    this.timer = null;
    this.burstStartedAt = null;
    this.sendStateVector();
  }
}
