import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  WifiOff,
  LoaderCircle,
  ScanFace,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  avatarWide,
  heroBackground,
  heroCharacter,
  kokoroLogo,
} from "./assets";
import { useAuthStore } from "./lib/store/authStore";
import { avatarsApi } from "./lib/api";
import type { AvatarModel } from "./lib/api/types";
import AuthRoute from "./components/auth/AuthRoute";
import { getAvatarCustomizationPath } from "./lib/avatar/avatarSetup";
import { avatarDraftKey, avatarFlowPath, type AvatarFlowMode } from "./lib/avatar/avatarFlow";
import {
  getLoginErrorMessage,
  getPasswordStrength,
  getPostRestorePath,
  getRegistrationEmailError,
  getRegistrationUsernameError,
  isRegistrationValid,
  normalizeUsername,
} from "./lib/auth/authFlow";
import "./App.css";

const SPLASH_MIN_DURATION_MS = 2_000;
const AvatarMotionPreview = lazy(() => import("./components/avatar/AvatarMotionPreview"));
const LocalVrmThumbnail = lazy(() => import("./components/avatar/LocalVrmThumbnail"));
const AvatarColorLab = lazy(() => import("./components/avatar/AvatarColorLab"));
const AvatarPreviewScreen = lazy(() => import("./components/avatar/AvatarPreviewScreen"));
const HomeScreen = lazy(() => import("./components/home/HomeScreen"));
const ProfileScreen = lazy(() => import("./components/connected/ProfileScreen"));
const VideoLibraryScreen = lazy(() => import("./components/connected/VideoLibraryScreen"));
const TrackingDevHarness = import.meta.env.DEV
  ? lazy(() => import("./components/dev/TrackingDevHarness"))
  : null;
const AvatarRendererDevHarness = import.meta.env.DEV
  ? lazy(() => import("./components/dev/AvatarRendererDevHarness"))
  : null;
const FacialDevHarness = import.meta.env.DEV
  ? lazy(() => import("./components/dev/FacialDevHarness"))
  : null;

function SplashScreen() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const startedAt = Date.now();
    void restoreSession().finally(() => {
      const remaining = Math.max(0, SPLASH_MIN_DURATION_MS - (Date.now() - startedAt));
      window.setTimeout(() => {
        navigate(getPostRestorePath(useAuthStore.getState().status), { replace: true });
      }, remaining);
    });
  }, [navigate, restoreSession]);

  return (
    <main className="dark splash-screen" aria-busy={status === "idle"}>
      <div className="splash-brand">
        <img src={kokoroLogo} alt="Kokoro" />
        <h1>Kokoro</h1>
        <LoaderCircle className="splash-spinner" aria-label="Đang tải" />
      </div>
    </main>
  );
}

function WelcomeScreen() {
  const navigate = useNavigate();

  return (
    <main className="dark welcome-screen">
      <section className="welcome-content">
        <header className="brand-lockup">
          <img className="brand-mark-image" src={kokoroLogo} alt="Kokoro logo" />
          <div>
            <h1>Kokoro</h1>
            <p>Mạng xã hội cho VTuber</p>
          </div>
        </header>

        <div className="welcome-copy">
          <h2>
            Nhân vật của bạn.<br />
            <em>Thế giới của bạn.</em>
          </h2>
          <p>
            Tạo hồ sơ, trò chuyện và kết nối với cộng đồng trong không gian dành riêng cho nhân vật của bạn.
          </p>
        </div>

        <div className="welcome-actions">
          <button className="primary" onClick={() => navigate("/onboarding")}>
            Tạo tài khoản
          </button>
          <button className="welcome-login-link" onClick={() => navigate("/login")}>
            Đăng nhập <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <div className="welcome-visual" aria-hidden="true">
        <img src={heroCharacter} alt="" />
      </div>
    </main>
  );
}

function LoginScreen() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const isLoading = useAuthStore((state) => state.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    try {
      await login(email, password);
      navigate("/home", { replace: true });
    } catch {
      setErrorMessage(getLoginErrorMessage());
    }
  }

  return (
    <main className="dark auth-page">
      <div className="auth-frame">
        <button className="icon-button back" onClick={() => navigate("/welcome")} aria-label="Quay lại">
          <ChevronLeft aria-hidden="true" />
        </button>

        <section className="auth-visual" aria-hidden="true">
          <img src={heroCharacter} alt="" />
          <div>
            <span className="eyebrow">Kokoro</span>
            <h2>Trở lại thế giới của bạn.</h2>
            <p>Tiếp tục những cuộc trò chuyện và kết nối theo cách riêng của bạn.</p>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-heading">
            <div className="auth-brand">
              <img src={kokoroLogo} alt="" />
              <span>Kokoro</span>
            </div>
            <h1>Đăng nhập</h1>
            <p>Tiếp tục vào không gian Kokoro của bạn.</p>
          </div>

          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}

          <form onSubmit={handleSubmit}>
            <label htmlFor="login-email">Email
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                disabled={isLoading}
              />
            </label>

            <label htmlFor="login-password">Mật khẩu
              <div className="password-wrap">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </label>

            <button className="forgot-password" type="button" disabled title="Sắp ra mắt">
              Quên mật khẩu?
            </button>

            <button className="primary wide" type="submit" disabled={isLoading}>
              {isLoading && <LoaderCircle className="button-spinner" aria-hidden="true" />}
              {isLoading ? "Đang đăng nhập…" : "Vào Kokoro"}
            </button>
          </form>

          <div className="auth-switch">
            Chưa có tài khoản?{" "}
            <button onClick={() => navigate("/onboarding")}>Đăng ký</button>
          </div>
        </section>
      </div>
    </main>
  );
}

const onboardingSlides = [
  {
    eyebrow: "Thể hiện bản thân",
    title: "Giao tiếp theo cách của bạn",
    description: "Thể hiện bản thân qua nhân vật ảo độc đáo — khuôn mặt thật, luôn được bảo vệ.",
    icon: Sparkles,
    image: heroCharacter,
  },
  {
    eyebrow: "Theo dõi thời gian thực",
    title: "Chuyển động của bạn, nhân vật của bạn",
    description: "Kokoro nhận diện chuyển động và điều khiển nhân vật ảo ngay lập tức, hoàn toàn trên thiết bị.",
    icon: ScanFace,
    image: avatarWide,
  },
  {
    eyebrow: "Riêng tư từ thiết kế",
    title: "Khuôn mặt thật không rời thiết bị",
    description: "Chỉ chuyển động nhân vật và âm thanh được truyền đi. Hình ảnh khuôn mặt thật không bao giờ được gửi lên server.",
    icon: ShieldCheck,
    image: null,
  },
] as const;

function OnboardingScreen() {
  const navigate = useNavigate();
  const [slideIndex, setSlideIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const slide = onboardingSlides[slideIndex];
  const SlideIcon = slide.icon;

  function goNext() {
    if (slideIndex === onboardingSlides.length - 1) navigate("/register");
    else setSlideIndex((current) => current + 1);
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLElement>) {
    if (touchStartX.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta < -50) goNext();
    if (delta > 50 && slideIndex > 0) setSlideIndex((current) => current - 1);
  }

  return (
    <main
      className="dark intro-screen"
      onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }}
      onTouchEnd={handleTouchEnd}
    >
      <button className="intro-skip" onClick={() => navigate("/register")}>Bỏ qua</button>

      <section className="intro-card" key={slideIndex}>
        <div className="intro-visual" aria-hidden="true">
          {slide.image
            ? <img src={slide.image} alt="" />
            : <div className="privacy-orb"><ShieldCheck /></div>}
        </div>
        <div className="intro-copy">
          <span><SlideIcon /> {slide.eyebrow}</span>
          <h1>{slide.title}</h1>
          <p>{slide.description}</p>

          <div className="intro-dots" aria-label={`Trang ${slideIndex + 1} trên 3`}>
            {onboardingSlides.map((item, index) => (
              <button
                key={item.title}
                className={index === slideIndex ? "active" : ""}
                onClick={() => setSlideIndex(index)}
                aria-label={`Đi tới trang ${index + 1}`}
              />
            ))}
          </div>

          <button className="primary intro-next" onClick={goNext}>
            {slideIndex === 2 ? "Bắt đầu" : "Tiếp theo"} <ChevronRight />
          </button>
          {slideIndex === 2 && (
            <button className="intro-login" onClick={() => navigate("/login")}>
              Đã có tài khoản? Đăng nhập
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function RegisterScreen() {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const isLoading = useAuthStore((state) => state.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameSearchable, setUsernameSearchable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const strength = getPasswordStrength(password);
  const canSubmit = isRegistrationValid(email, password, displayName, username) && !isLoading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setEmailError(null);
    setUsernameError(null);
    setFormError(null);

    try {
      await register(
        email.trim(),
        password,
        displayName.trim(),
        normalizeUsername(username),
        usernameSearchable,
      );
      navigate("/avatar/setup", { replace: true });
    } catch (error) {
      const conflict = getRegistrationEmailError(error);
      const usernameConflict = getRegistrationUsernameError(error);
      if (conflict) setEmailError(conflict);
      else if (usernameConflict) setUsernameError(usernameConflict);
      else setFormError("Không thể tạo tài khoản. Vui lòng kiểm tra thông tin và thử lại.");
    }
  }

  return (
    <main className="dark auth-page">
      <div className="auth-frame register-frame">
        <button className="icon-button back" onClick={() => navigate("/onboarding")} aria-label="Quay lại">
          <ChevronLeft aria-hidden="true" />
        </button>
        <section className="auth-visual" aria-hidden="true">
          <img src={heroCharacter} alt="" />
          <div>
            <span className="eyebrow">Kokoro</span>
            <h2>Nhân vật của bạn. Thế giới của bạn.</h2>
            <p>Tạo danh tính và bắt đầu những cuộc trò chuyện theo cách riêng của bạn.</p>
          </div>
        </section>
        <section className="auth-panel">
          <div className="auth-heading">
            <div className="auth-brand"><img src={kokoroLogo} alt="" /><span>Kokoro</span></div>
            <h1>Tạo tài khoản</h1>
            <p>Bắt đầu xây dựng không gian Kokoro của bạn.</p>
          </div>

          {formError && <div className="auth-error" role="alert">{formError}</div>}
          <form onSubmit={handleSubmit}>
            <label htmlFor="register-email">Email
              <input id="register-email" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(null); }} placeholder="you@example.com" required disabled={isLoading} aria-invalid={Boolean(emailError)} />
              {emailError && <small className="field-error">{emailError}</small>}
            </label>
            <label htmlFor="register-password">Mật khẩu
              <div className="password-wrap">
                <input id="register-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required disabled={isLoading} />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className={`strength-meter strength-${strength.score}`} aria-label={`Độ mạnh mật khẩu: ${strength.score} trên 4`}>
                {[1, 2, 3, 4].map((segment) => <i key={segment} className={segment <= strength.score ? "active" : ""} />)}
              </div>
              <small className="strength-label">{strength.label}</small>
            </label>
            <label htmlFor="register-name">Tên hiển thị
              <input id="register-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ví dụ: Yozakura Luna" maxLength={100} required disabled={isLoading} />
            </label>
            <label htmlFor="register-username">Username
              <input
                id="register-username"
                autoComplete="username"
                value={username}
                onChange={(event) => { setUsername(event.target.value); setUsernameError(null); }}
                onBlur={() => setUsername(normalizeUsername(username))}
                placeholder="ví dụ: luna.night"
                minLength={3}
                maxLength={30}
                required
                disabled={isLoading}
                aria-invalid={Boolean(usernameError)}
              />
              <small>3–30 ký tự: a–z, 0–9, dấu chấm hoặc gạch dưới.</small>
              {usernameError && <small className="field-error">{usernameError}</small>}
            </label>
            <label className="auth-consent" htmlFor="register-username-searchable">
              <input
                id="register-username-searchable"
                type="checkbox"
                checked={usernameSearchable}
                onChange={(event) => setUsernameSearchable(event.target.checked)}
                disabled={isLoading}
              />
              <span>Cho phép người khác tìm thấy tôi bằng @username.</span>
            </label>
            <button className="primary wide" type="submit" disabled={!canSubmit}>
              {isLoading && <LoaderCircle className="button-spinner" />} {isLoading ? "Đang tạo…" : "Đăng ký"}
            </button>
          </form>
          <p className="register-terms">Bằng cách đăng ký, bạn đồng ý với <a href="#terms">Điều khoản sử dụng</a> và <a href="#privacy">Chính sách bảo mật</a>.</p>
          <div className="auth-switch">Đã có tài khoản? <button onClick={() => navigate("/login")}>Đăng nhập</button></div>
        </section>
      </div>
    </main>
  );
}

function AvatarSelectScreen({ mode = "onboarding" }: { mode?: AvatarFlowMode }) {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id);
  const [models, setModels] = useState<AvatarModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(models.length / 6));
  const safePage = Math.min(page, pageCount);
  const visibleModels = models.slice((safePage - 1) * 6, safePage * 6);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError("");
    void Promise.all([
      avatarsApi.getModels(),
      mode === "edit" ? avatarsApi.getMyAvatar() : Promise.resolve(null),
    ])
      .then(([response, profile]) => {
        if (!active) return;
        setModels(response.models);
        if (profile && userId) {
          setSelectedModelId(profile.model_id);
          sessionStorage.setItem(avatarDraftKey(userId, profile.model_id), JSON.stringify({ modelId: profile.model_id, ...profile.customizations }));
          const index = response.models.findIndex((item) => item.id === profile.model_id);
          if (index >= 0) setPage(Math.floor(index / 6) + 1);
        }
      })
      .catch(() => { if (active) setCatalogError("Không thể tải danh sách avatar. Kiểm tra kết nối rồi thử lại."); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [mode, userId]);
  const showPage = (nextPage: number) => {
    const safePage = Math.min(Math.max(1, nextPage), pageCount);
    setHoveredModelId(null);
    setPage(safePage);
  };

  return (
    <main className="dark avatar-select-page">
      <img className="avatar-select-background" src={heroBackground} alt="" />
      <section className="avatar-select-card">
        <header className="avatar-setup-header">
          <button className="icon-button" onClick={() => navigate(mode === "edit" ? "/profile" : "/register")} aria-label="Quay lại">
            <ChevronLeft />
          </button>
          <div className="avatar-progress" aria-label="Bước 1 trên 3">
            {[
              ["1", "Chọn"],
              ["2", "Tùy chỉnh"],
              ["3", "Xem trước"],
            ].map(([number, label], index) => (
              <div className={index === 0 ? "active" : ""} key={number}>
                <span>{number}</span><small>{label}</small>
              </div>
            ))}
          </div>
        </header>

        <div className="avatar-select-heading">
          <span>Bước 1 / 3</span>
          <h1>Chọn avatar của bạn</h1>
          <p>Chọn một model 3D làm diện mạo khi gọi video và trò chuyện trong Kokoro.</p>
        </div>

        <div className="avatar-page-cache" aria-live="polite">
          {catalogLoading && <div className="avatar-catalog-state"><LoaderCircle className="button-spinner" /> Đang tải catalog avatar…</div>}
          {catalogError && <div className="avatar-catalog-state is-error"><span>{catalogError}</span><button type="button" onClick={() => window.location.reload()}>Thử lại</button></div>}
          {!catalogLoading && !catalogError && <div className="avatar-model-grid">
                {visibleModels.map((model, index) => {
                  const selected = selectedModelId === model.id;
                  const globalIndex = (safePage - 1) * 6 + index;
                  const motion = hoveredModelId === model.id
                    ? (globalIndex % 2 === 0 ? "wave-right" : "wave-left")
                    : "sway";
                  return (
                    <button
                      key={model.id}
                      className={selected ? "selected" : ""}
                      onClick={() => setSelectedModelId(model.id)}
                      onMouseEnter={() => setHoveredModelId(model.id)}
                      onMouseLeave={() => setHoveredModelId((current) => current === model.id ? null : current)}
                      onFocus={() => setHoveredModelId(model.id)}
                      onBlur={() => setHoveredModelId((current) => current === model.id ? null : current)}
                      aria-pressed={selected}
                    >
                      <Suspense fallback={<div className="local-vrm-thumbnail is-loading"><span><LoaderCircle /> Đang tải VRM…</span></div>}>
                        <LocalVrmThumbnail name={model.name} url={model.thumbnail_url} motion={motion} />
                      </Suspense>
                      <span>{model.name}</span>
                      {selected && <b aria-label="Đã chọn"><Check /></b>}
                    </button>
                  );
                })}
              </div>}
        </div>

        <nav className="avatar-pagination" aria-label="Phân trang danh sách avatar">
          <button
            type="button"
            onClick={() => showPage(safePage - 1)}
            disabled={safePage === 1}
            aria-label="Trang avatar trước"
          ><ChevronLeft /></button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button
              type="button"
              key={pageNumber}
              className={pageNumber === safePage ? "active" : ""}
              onClick={() => showPage(pageNumber)}
              aria-label={`Trang avatar ${pageNumber}`}
              aria-current={pageNumber === safePage ? "page" : undefined}
            >{pageNumber}</button>
          ))}
          <button
            type="button"
            onClick={() => showPage(safePage + 1)}
            disabled={safePage === pageCount}
            aria-label="Trang avatar sau"
          ><ChevronRight /></button>
        </nav>

        <footer className="avatar-select-actions">
          <button className="secondary" onClick={() => navigate(mode === "edit" ? "/profile" : "/register")}>Quay lại</button>
          <button
            className="primary"
            disabled={!selectedModelId}
            onClick={() => selectedModelId && navigate(mode === "edit" ? avatarFlowPath(mode, "customize", selectedModelId) : getAvatarCustomizationPath(selectedModelId))}
          >
            Tiếp theo <ChevronRight />
          </button>
        </footer>
      </section>
    </main>
  );
}

function TaskPlaceholder({ title, task, backTo = "/home" }: { title: string; task: string; backTo?: string }) {
  const navigate = useNavigate();
  return (
    <main className="task-placeholder">
      <img src={kokoroLogo} alt="Kokoro" />
      <h1>{title}</h1>
      <p>Màn hình này sẽ được hoàn thiện trong {task}.</p>
      <button className="primary" onClick={() => navigate(backTo)}>Quay lại Kokoro</button>
    </main>
  );
}

function LegacyConversationRedirect() {
  const { conversationId } = useParams();
  return <Navigate to={conversationId ? `/home?conversation=${encodeURIComponent(conversationId)}` : "/home"} replace />;
}

function AppRoutes() {
  const guest = (screen: React.ReactNode) => <AuthRoute mode="guest">{screen}</AuthRoute>;
  const protectedRoute = (screen: React.ReactNode) => <AuthRoute mode="protected">{screen}</AuthRoute>;
  const avatarSetup = (screen: React.ReactNode) => <AuthRoute mode="avatar-setup">{screen}</AuthRoute>;

  return (
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/welcome" element={guest(<WelcomeScreen />)} />
      <Route path="/onboarding" element={guest(<OnboardingScreen />)} />
      <Route path="/login" element={guest(<LoginScreen />)} />
      <Route path="/register" element={guest(<RegisterScreen />)} />
      <Route path="/avatar/setup" element={avatarSetup(<AvatarSelectScreen />)} />
      <Route path="/avatar/color-lab" element={avatarSetup(<Navigate to="/avatar/customize" replace />)} />
      <Route path="/avatar/motion" element={protectedRoute(<Suspense fallback={<div>Đang tải avatar…</div>}><AvatarMotionPreview /></Suspense>)} />
      <Route path="/avatar/customize" element={avatarSetup(<Suspense fallback={<div>Đang tải tùy chỉnh avatar…</div>}><AvatarColorLab /></Suspense>)} />
      <Route path="/avatar/preview" element={avatarSetup(<Suspense fallback={<div>Đang tải xem trước avatar…</div>}><AvatarPreviewScreen /></Suspense>)} />
      <Route path="/avatar/edit/setup" element={protectedRoute(<AvatarSelectScreen mode="edit" />)} />
      <Route path="/avatar/edit/customize" element={protectedRoute(<Suspense fallback={<div>Đang tải tùy chỉnh avatar…</div>}><AvatarColorLab mode="edit" /></Suspense>)} />
      <Route path="/avatar/edit/preview" element={protectedRoute(<Suspense fallback={<div>Đang tải xem trước avatar…</div>}><AvatarPreviewScreen mode="edit" /></Suspense>)} />
      <Route path="/home" element={protectedRoute(<Suspense fallback={<div>Đang tải trò chuyện…</div>}><HomeScreen /></Suspense>)} />
      <Route path="/search" element={protectedRoute(<Navigate to="/home?find=people" replace />)} />
      <Route path="/videos" element={protectedRoute(<Suspense fallback={<div>Đang tải video…</div>}><VideoLibraryScreen /></Suspense>)} />
      <Route path="/videos/record" element={protectedRoute(<TaskPlaceholder title="Quay video avatar" task="P4-T20" />)} />
      <Route path="/calls/new" element={protectedRoute(<TaskPlaceholder title="Gọi video" task="P4-T15–P4-T17" />)} />
      <Route path="/calls/incoming" element={protectedRoute(<TaskPlaceholder title="Cuộc gọi đến" task="P4-T18–P4-T19" />)} />
      <Route path="/profile" element={protectedRoute(<Suspense fallback={<div>Đang tải hồ sơ…</div>}><ProfileScreen /></Suspense>)} />
      <Route path="/conversations/:conversationId" element={protectedRoute(<LegacyConversationRedirect />)} />
      {TrackingDevHarness && (
        <Route path="/dev/tracking" element={<Suspense fallback={<div>Đang tải tracking harness…</div>}><TrackingDevHarness /></Suspense>} />
      )}
      {AvatarRendererDevHarness && (
        <Route path="/dev/avatar-renderer" element={<Suspense fallback={<div>Đang tải avatar renderer…</div>}><AvatarRendererDevHarness /></Suspense>} />
      )}
      {FacialDevHarness && (
        <Route path="/dev/facial" element={<Suspense fallback={<div>Đang tải facial lab…</div>}><FacialDevHarness /></Suspense>} />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ConnectivityNotice() {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const online = () => setOffline(false), offlineHandler = () => setOffline(true);
    window.addEventListener("online", online); window.addEventListener("offline", offlineHandler);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offlineHandler); };
  }, []);
  if (!offline) return null;
  return <aside className="connectivity-notice" role="alert" aria-live="assertive"><WifiOff /><div><strong>Không có kết nối mạng</strong><span>Kokoro sẽ tự kết nối lại khi mạng ổn định.</span></div><button type="button" onClick={() => window.location.reload()}>Thử lại</button></aside>;
}

function App() {
  return (
    <BrowserRouter>
      <ConnectivityNotice />
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
