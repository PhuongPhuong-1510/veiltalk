import { useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Navigate } from "react-router-dom";
import { kokoroLogo } from "../../assets";
import { getAuthRouteRedirect, type AuthRouteMode } from "../../lib/auth/routeAccess";
import { useAuthStore } from "../../lib/store/authStore";

export default function AuthRoute({ mode, children }: { mode: AuthRouteMode; children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const hasAvatar = useAuthStore((state) => state.user?.has_avatar === true);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (status !== "idle" || restoreStarted.current) return;
    restoreStarted.current = true;
    void restoreSession();
  }, [restoreSession, status]);

  if (status === "idle") {
    return (
      <main className="dark auth-route-loading" aria-busy="true">
        <img src={kokoroLogo} alt="Kokoro" />
        <LoaderCircle aria-label="Đang khôi phục phiên đăng nhập" />
      </main>
    );
  }

  const redirect = getAuthRouteRedirect(status, mode, hasAvatar);
  if (redirect) return <Navigate to={redirect} replace />;
  return children;
}
