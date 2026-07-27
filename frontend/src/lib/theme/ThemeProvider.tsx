import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { usersApi } from "../api";
import { useAuthStore } from "../store/authStore";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext";
import {
  applyResolvedTheme,
  DARK_MODE_QUERY,
  resolveTheme,
  type ThemePreference,
} from "./theme";

export function ThemeProvider({ children }: PropsWithChildren) {
  const authStatus = useAuthStore((state) => state.status);
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia(DARK_MODE_QUERY).matches,
  );
  const requestVersionRef = useRef(0);

  const resolvedTheme = resolveTheme(theme, systemPrefersDark);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyResolvedTheme(document.documentElement, resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;

    if (authStatus !== "authenticated") {
      setThemeState("system");
      return;
    }

    void usersApi.getSettings().then((settings) => {
      if (requestVersion === requestVersionRef.current) {
        setThemeState(settings.theme);
      }
    }).catch(() => {
      // Giữ theme system khi không tải được settings; lỗi mạng không chặn render app.
    });
  }, [authStatus]);

  const setTheme = useCallback(async (nextTheme: ThemePreference) => {
    const previousTheme = theme;
    setThemeState(nextTheme);

    if (authStatus !== "authenticated") {
      return;
    }

    try {
      const settings = await usersApi.updateSettings({ theme: nextTheme });
      setThemeState(settings.theme);
    } catch (error) {
      setThemeState(previousTheme);
      throw error;
    }
  }, [authStatus, theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
  }), [resolvedTheme, setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
