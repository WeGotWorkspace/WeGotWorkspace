import type { DocsRelayCopy } from "./docs-relay-copy";
import "./docs-collab-relay-banner.css";

export function DocsCollabRelayBanner({ copy }: { copy: DocsRelayCopy }) {
  return (
    <div className="docs-collab-relay" role="status">
      <p className="docs-collab-relay__message">{copy.message}</p>
      {copy.setupHref ? (
        <a className="docs-collab-relay__link" href={copy.setupHref}>
          Set up
        </a>
      ) : null}
      {copy.planHref ? (
        <a className="docs-collab-relay__link" href={copy.planHref}>
          Plan
        </a>
      ) : null}
    </div>
  );
}
