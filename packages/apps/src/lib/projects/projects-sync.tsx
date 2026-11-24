import { useEffect } from "react";
import { useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { projectsStore, type ProjectsStore } from "@/lib/projects/projects-store";

const PROJECT_PUSH_TYPES = ["Project"] as const;

/**
 * Loads the Projects once for the live shell and reads them again when the server pushes a
 * `Project` state change or the browser comes back online. Renders nothing.
 */
export function ProjectsSync({ store = projectsStore() }: { store?: ProjectsStore }) {
  useEffect(() => {
    void store.load();
    const onOnline = () => void store.load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [store]);
  useJmapStateChange(PROJECT_PUSH_TYPES, () => store.load());
  return null;
}
