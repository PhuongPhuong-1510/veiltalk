// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../lib/store/authStore";
import AuthRoute from "./AuthRoute";

let container: HTMLDivElement;
let root: Root;
const originalRestoreSession = useAuthStore.getState().restoreSession;

function RegistrationRoutes() {
  return (
    <MemoryRouter initialEntries={["/register"]}>
      <Routes>
        <Route
          path="/register"
          element={<AuthRoute mode="guest"><div>register page</div></AuthRoute>}
        />
        <Route path="/home" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function AvatarSetupRoutes() {
  return (
    <MemoryRouter initialEntries={["/avatar/setup"]}>
      <Routes>
        <Route
          path="/avatar/setup"
          element={<AuthRoute mode="avatar-setup"><div>avatar setup page</div></AuthRoute>}
        />
        <Route path="/home" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    status: "idle",
    isLoading: false,
    restoreSession: originalRestoreSession,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthRoute", () => {
  it("redirects an authenticated user away from the registration URL", async () => {
    useAuthStore.setState({ status: "authenticated", user: { id: "u1", email: "a@b.com", display_name: "A", role: "user", has_avatar: true, created_at: "2026-01-01T00:00:00Z" } });

    await act(async () => root.render(<RegistrationRoutes />));

    expect(container.textContent).toContain("home page");
    expect(container.textContent).not.toContain("register page");
  });

  it("restores a saved session before deciding whether to show registration", async () => {
    const restoreSession = vi.fn(async () => {
      useAuthStore.setState({ status: "authenticated", user: { id: "u1", email: "a@b.com", display_name: "A", role: "user", has_avatar: true, created_at: "2026-01-01T00:00:00Z" } });
    });
    useAuthStore.setState({ status: "idle", restoreSession });

    await act(async () => root.render(<RegistrationRoutes />));

    expect(restoreSession).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("home page");
    expect(container.textContent).not.toContain("register page");
  });

  it("blocks the post-registration avatar wizard after avatar setup is complete", async () => {
    useAuthStore.setState({ status: "authenticated", user: { id: "u1", email: "a@b.com", display_name: "A", role: "user", has_avatar: true, created_at: "2026-01-01T00:00:00Z" } });

    await act(async () => root.render(<AvatarSetupRoutes />));

    expect(container.textContent).toContain("home page");
    expect(container.textContent).not.toContain("avatar setup page");
  });

  it("allows a newly registered account without an avatar to finish the wizard", async () => {
    useAuthStore.setState({ status: "authenticated", user: { id: "u1", email: "a@b.com", display_name: "A", role: "user", has_avatar: false, created_at: "2026-01-01T00:00:00Z" } });

    await act(async () => root.render(<AvatarSetupRoutes />));

    expect(container.textContent).toContain("avatar setup page");
  });
});
