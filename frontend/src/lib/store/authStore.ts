import { create } from "zustand";
import { configureAuthHooks } from "../api/client";
import { authApi, usersApi } from "../api";
import type { User } from "../api/types";

// Refresh token: sessionStorage (tab-scoped, tự xóa khi đóng tab) — đánh đổi
// có ý thức giữa UX (không bắt đăng nhập lại mỗi lần F5) và bề mặt tấn công XSS.
// Phương án đã cân nhắc: giữ refresh token trong memory như access token — an
// toàn hơn (không script nào đọc được qua storage API) nhưng mất session mỗi
// lần reload trang, bắt user đăng nhập lại liên tục — đánh đổi UX không chấp
// nhận được cho một app nhắn tin/gọi video. sessionStorage giảm cửa sổ tấn
// công so với localStorage (không tồn tại sau khi đóng tab) nên được chọn.
//
// Giới hạn đa tab (chấp nhận cho MVP, chưa cần BroadcastChannel): logout ở
// tab A không đồng bộ sang tab B ngay — tab B vẫn coi là đăng nhập cho tới khi
// access token hết hạn (tối đa 15 phút) rồi tự refresh thất bại. Backlog nếu
// cần đồng bộ tức thời: BroadcastChannel hoặc storage event listener.
const REFRESH_TOKEN_KEY = "veiltalk_refresh_token";

let refreshTokenRef: string | null = sessionStorage.getItem(REFRESH_TOKEN_KEY);

function persistRefreshToken(token: string | null): void {
  refreshTokenRef = token;
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

function clearSearchHistory(userId: string | undefined): void {
  if (userId && typeof localStorage !== "undefined") {
    localStorage.removeItem(`veiltalk-user-search-history:${userId}`);
  }
}

export type AuthStatus = "idle" | "authenticated" | "unauthenticated";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  status: AuthStatus;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
    username: string,
    usernameSearchable: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  markAvatarSetupComplete: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  configureAuthHooks({
    getAccessToken: () => get().accessToken,
    getRefreshToken: () => refreshTokenRef,
    onTokensRefreshed: (accessToken) => set({ accessToken }),
    onAuthFailure: () => {
      clearSearchHistory(get().user?.id);
      persistRefreshToken(null);
      set({ user: null, accessToken: null, status: "unauthenticated" });
    },
  });

  return {
    user: null,
    accessToken: null,
    status: "idle",
    isLoading: false,

    async login(email, password) {
      set({ isLoading: true });
      try {
        const { user, tokens } = await authApi.login(email, password);
        persistRefreshToken(tokens.refresh_token);
        set({ user, accessToken: tokens.access_token, status: "authenticated", isLoading: false });
        // Login responses can come from an older session snapshot. Refresh the
        // profile so an existing user's selected 3D-character portrait is shown
        // immediately on Home/Profile instead of falling back to an initial.
        try {
          const refreshedUser = await usersApi.getMe();
          if (refreshedUser) set({ user: refreshedUser });
        } catch {
          // The authenticated session is still valid; keep the login payload.
        }
      } catch (error) {
        set({ isLoading: false });
        throw error;
      }
    },

    async register(email, password, displayName, username, usernameSearchable) {
      set({ isLoading: true });
      try {
        const { user, tokens } = await authApi.register(
          email,
          password,
          displayName,
          username,
          usernameSearchable,
        );
        persistRefreshToken(tokens.refresh_token);
        set({ user, accessToken: tokens.access_token, status: "authenticated", isLoading: false });
      } catch (error) {
        set({ isLoading: false });
        throw error;
      }
    },

    async logout() {
      const userId = get().user?.id;
      const token = refreshTokenRef;
      if (token) {
        try {
          await authApi.logout(token);
        } catch {
          // best-effort: user đã đăng xuất phía client dù API lỗi mạng/hết hạn
        }
      }
      persistRefreshToken(null);
      clearSearchHistory(userId);
      set({ user: null, accessToken: null, status: "unauthenticated" });
    },

    async restoreSession() {
      const token = refreshTokenRef;
      if (!token) {
        set({ status: "unauthenticated" });
        return;
      }

      try {
        const { access_token } = await authApi.refresh(token);
        set({ accessToken: access_token });
        const user = await usersApi.getMe();
        set({ user, status: "authenticated" });
      } catch {
        persistRefreshToken(null);
        set({ user: null, accessToken: null, status: "unauthenticated" });
      }
    },

    markAvatarSetupComplete() {
      set((state) => ({
        user: state.user ? { ...state.user, has_avatar: true } : null,
      }));
    },
    setUser(user) {
      set({ user });
    },
  };
});
