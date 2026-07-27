import { describe, expect, it, vi } from "vitest";
import { applyResolvedTheme, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("giữ nguyên explicit light/dark preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolve system theo media preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("applyResolvedTheme", () => {
  it("gắn class dark và color-scheme cho dark theme", () => {
    const toggle = vi.fn();
    const root = { classList: { toggle }, style: { colorScheme: "" } };

    applyResolvedTheme(root, "dark");

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("gỡ class dark và color-scheme cho light theme", () => {
    const toggle = vi.fn();
    const root = { classList: { toggle }, style: { colorScheme: "dark" } };

    applyResolvedTheme(root, "light");

    expect(toggle).toHaveBeenCalledWith("dark", false);
    expect(root.style.colorScheme).toBe("light");
  });
});
