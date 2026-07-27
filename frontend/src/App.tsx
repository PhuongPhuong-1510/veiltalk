import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  avatarDark,
  avatarWide,
  heroBackground,
  heroCharacter,
  kokoroLogo,
  neonScene,
  profilePortrait,
  welcomeNeon,
} from "./assets";
import { useAuthStore } from "./lib/store/authStore";
import { avatarsApi } from "./lib/api";
import type { AvatarModel } from "./lib/api/types";
import { getAvatarCustomizationPath, getAvatarThumbnailSrc } from "./lib/avatar/avatarSetup";
import {
  getLoginErrorMessage,
  getPasswordStrength,
  getPostRestorePath,
  getRegistrationEmailError,
  isRegistrationValid,
} from "./lib/auth/authFlow";
import "./App.css";

const SPLASH_MIN_DURATION_MS = 2_000;
const TrackingDevHarness = import.meta.env.DEV
  ? lazy(() => import("./components/dev/TrackingDevHarness"))
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
      <img className="welcome-new-background" src={heroBackground} alt="" />
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
      <img className="auth-background" src={heroBackground} alt="" />
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
      <img className="intro-background" src={heroBackground} alt="" />
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
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const strength = getPasswordStrength(password);
  const canSubmit = isRegistrationValid(email, password, displayName) && !isLoading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setEmailError(null);
    setFormError(null);

    try {
      await register(email.trim(), password, displayName.trim());
      navigate("/avatar/setup", { replace: true });
    } catch (error) {
      const conflict = getRegistrationEmailError(error);
      if (conflict) setEmailError(conflict);
      else setFormError("Không thể tạo tài khoản. Vui lòng kiểm tra thông tin và thử lại.");
    }
  }

  return (
    <main className="dark auth-page">
      <img className="auth-background" src={heroBackground} alt="" />
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

const avatarFallbacks = [
  profilePortrait,
  welcomeNeon,
  avatarDark,
  avatarWide,
  heroCharacter,
  neonScene,
];

function AvatarSelectScreen() {
  const navigate = useNavigate();
  const [models, setModels] = useState<AvatarModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError(false);

    void avatarsApi.getModels()
      .then(({ models: responseModels }) => {
        if (!active) return;
        setModels(responseModels);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(true);
        setIsLoading(false);
      });

    return () => { active = false; };
  }, [loadVersion]);

  return (
    <main className="dark avatar-select-page">
      <img className="avatar-select-background" src={heroBackground} alt="" />
      <section className="avatar-select-card">
        <header className="avatar-setup-header">
          <button className="icon-button" onClick={() => navigate("/register")} aria-label="Quay lại">
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

        {isLoading && (
          <div className="avatar-loading" role="status"><LoaderCircle /> Đang tải danh sách avatar…</div>
        )}

        {loadError && (
          <div className="avatar-load-error" role="alert">
            <p>Không thể tải danh sách avatar. Hãy kiểm tra kết nối backend.</p>
            <button onClick={() => setLoadVersion((value) => value + 1)}><RefreshCw /> Thử lại</button>
          </div>
        )}

        {!isLoading && !loadError && (
          <div className="avatar-model-grid">
            {models.map((model, index) => {
              const fallback = avatarFallbacks[index % avatarFallbacks.length];
              const selected = selectedModelId === model.id;
              return (
                <button
                  key={model.id}
                  className={selected ? "selected" : ""}
                  onClick={() => setSelectedModelId(model.id)}
                  aria-pressed={selected}
                >
                  <img
                    src={getAvatarThumbnailSrc(model, fallback)}
                    onError={(event) => { event.currentTarget.src = fallback; }}
                    alt={`Avatar ${model.name}`}
                  />
                  <span>{model.name}</span>
                  {selected && <b aria-label="Đã chọn"><Check /></b>}
                </button>
              );
            })}
          </div>
        )}

        <footer className="avatar-select-actions">
          <button className="secondary" onClick={() => navigate("/register")}>Quay lại</button>
          <button
            className="primary"
            disabled={!selectedModelId}
            onClick={() => selectedModelId && navigate(getAvatarCustomizationPath(selectedModelId))}
          >
            Tiếp theo <ChevronRight />
          </button>
        </footer>
      </section>
    </main>
  );
}

function TaskPlaceholder({ title, task }: { title: string; task: string }) {
  const navigate = useNavigate();
  return (
    <main className="task-placeholder">
      <img src={kokoroLogo} alt="Kokoro" />
      <h1>{title}</h1>
      <p>Màn hình này sẽ được hoàn thiện trong {task}.</p>
      <button className="primary" onClick={() => navigate("/welcome")}>Về màn chào mừng</button>
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/welcome" element={<WelcomeScreen />} />
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/register" element={<RegisterScreen />} />
      <Route path="/avatar/setup" element={<AvatarSelectScreen />} />
      <Route path="/avatar/customize" element={<TaskPlaceholder title="Tùy chỉnh avatar" task="P4-T11" />} />
      <Route path="/home" element={<TaskPlaceholder title="Kokoro của bạn" task="P4-T12" />} />
      {TrackingDevHarness && (
        <Route path="/dev/tracking" element={<Suspense fallback={<div>Đang tải tracking harness…</div>}><TrackingDevHarness /></Suspense>} />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
