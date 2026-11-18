import { cn } from "@/lib/utils";
import type { SettingsMcpShareCall } from "@/lib/models/settings-types";

/** At most this many share calls per assistant, newest first. */
export const MCP_SHARE_ACTIVITY_LIMIT = 20;

function shareCallPath(target: string | null): string | null {
  if (target == null || target === "") return null;
  try {
    const parsed: unknown = JSON.parse(target);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "path" in parsed &&
      typeof parsed.path === "string" &&
      parsed.path !== ""
    ) {
      return parsed.path;
    }
  } catch {
    // Target is not JSON; show the stored string.
  }
  return target;
}

function shareCallTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shareCallOutcomeLabel(outcome: string): string | null {
  if (outcome === "ok") return null;
  if (outcome === "denied") return "Denied — external share";
  if (outcome === "error") return "Failed";
  return outcome;
}

/** Last share-tool calls of an assistant (Drive, Docs, Calendar… share tools). */
export function ShareActivity({ calls }: { calls: SettingsMcpShareCall[] }) {
  if (calls.length === 0) return null;
  return (
    <section className="settings-assistants-pane__share-calls">
      <h3 className="settings-assistants-pane__share-calls-title">Share activity</h3>
      <ul className="settings-assistants-pane__share-calls-list">
        {calls.map((call, index) => {
          const path = shareCallPath(call.target);
          const outcome = shareCallOutcomeLabel(call.outcome);
          return (
            <li
              key={`${call.tool}-${call.createdAt}-${index}`}
              className="settings-assistants-pane__share-call"
            >
              <span className="settings-assistants-pane__share-call-tool">{call.tool}</span>
              {path ? (
                <span className="settings-assistants-pane__share-call-target">{path}</span>
              ) : null}
              <time className="settings-assistants-pane__share-call-time" dateTime={call.createdAt}>
                {shareCallTimeLabel(call.createdAt)}
              </time>
              {outcome ? (
                <span
                  className={cn(
                    "settings-assistants-pane__share-call-outcome",
                    call.outcome === "denied" &&
                      "settings-assistants-pane__share-call-outcome--denied",
                  )}
                >
                  {outcome}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
