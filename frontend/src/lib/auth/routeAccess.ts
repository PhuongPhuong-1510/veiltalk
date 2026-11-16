import type { AuthStatus } from "../store/authStore";

export type AuthRouteMode = "guest" | "protected" | "avatar-setup";

export function getAuthRouteRedirect(
  status: AuthStatus,
  mode: AuthRouteMode,
  hasAvatar: boolean,
): "/home" | "/login" | "/avatar/setup" | null {
  if (status === "idle") return null;
  if (status === "unauthenticated") return mode === "guest" ? null : "/login";
  if (mode === "guest") return hasAvatar ? "/home" : "/avatar/setup";
  if (mode === "avatar-setup") return hasAvatar ? "/home" : null;
  if (!hasAvatar) return "/avatar/setup";
  return null;
}
