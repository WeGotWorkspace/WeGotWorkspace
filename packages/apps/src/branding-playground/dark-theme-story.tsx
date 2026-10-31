import { useEffect, type ReactNode } from "react";

/**
 * Story wrapper for the dark theme: its tokens live on `:root[data-theme="dark"]`,
 * so this flips <html> while the story is mounted and puts the old value back after.
 */
export function DarkThemeStoryRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
  }, []);
  return children;
}

/** `decorators: [withDarkTheme]` renders a story in the dark theme. */
export function withDarkTheme(Story: () => ReactNode) {
  return (
    <DarkThemeStoryRoot>
      <Story />
    </DarkThemeStoryRoot>
  );
}
