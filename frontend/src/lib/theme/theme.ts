import type { UserSettings } from "../api/types";

export type ThemePreference = UserSettings["theme"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ThemeRoot {
  classList: {
    toggle: (token: string, force?: boolean) => unknown;
  };
  style: {
    colorScheme: string;
  };
}

export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

export function applyResolvedTheme(root: ThemeRoot, theme: ResolvedTheme): void {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
