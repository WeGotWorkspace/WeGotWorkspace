import { MFA_SETUP_REQUIRED } from "@/lib/api/wgw/mfa-error";

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeMfaSetupRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchMfaSetupRequired(): void {
  for (const listener of listeners) listener();
}

export async function noticeMfaSetupRequiredResponse(res: Response): Promise<void> {
  if (res.status !== 403) return;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    if (body?.code === MFA_SETUP_REQUIRED) dispatchMfaSetupRequired();
  } catch {
    // A non-JSON 403 is not the enrollment gate.
  }
}
