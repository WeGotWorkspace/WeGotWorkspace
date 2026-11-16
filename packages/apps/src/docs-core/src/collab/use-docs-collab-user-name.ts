import { useLayoutEffect, useState } from "react";

const USERNAME_PROMPT = "Your display name";

function promptForUserName(): string | null {
  const input = window.prompt(USERNAME_PROMPT);
  if (input === null) return null;
  const trimmed = input.trim();
  return trimmed || null;
}

export type DocsCollabUserName = {
  userName: string | null;
  /** True once the prompt was answered or cancelled, so the gate can stop saying "Loading". */
  promptDismissed: boolean;
};

/**
 * Resolves the collaborator display name: the prop when one is given (tests,
 * Storybook, signed-in shells), otherwise a single `window.prompt` on first paint.
 */
export function useDocsCollabUserName(userNameProp: string | undefined): DocsCollabUserName {
  const [userName, setUserName] = useState<string | null>(() => userNameProp?.trim() || null);
  const [promptDismissed, setPromptDismissed] = useState(false);

  useLayoutEffect(() => {
    if (userNameProp?.trim()) {
      setUserName(userNameProp.trim());
      return;
    }
    if (userName !== null || promptDismissed) return;
    const name = promptForUserName();
    setPromptDismissed(true);
    if (name) setUserName(name);
  }, [userNameProp, userName, promptDismissed]);

  return { userName, promptDismissed };
}
