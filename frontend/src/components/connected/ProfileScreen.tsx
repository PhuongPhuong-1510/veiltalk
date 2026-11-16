import {
  Bell, ChevronDown, CircleUserRound, Database, Film, Image, LoaderCircle, LogOut,
  MessageCircle, MonitorCog, Pencil, Save, Search, ShieldCheck, Trash2, UserRound,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { kokoroLogo } from "../../assets";
import { usersApi } from "../../lib/api";
import type { UserSettings } from "../../lib/api/types";
import { useAuthStore } from "../../lib/store/authStore";
import { resolveMediaUrl } from "../../lib/api/client";
import { useTheme } from "../../lib/theme";
import "./profileScreen.css";

function ProfileNavigation({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate();
  const items = [
    { label: "Trò chuyện", icon: MessageCircle, path: "/home" },
    { label: "Video", icon: Film, path: "/videos" },
    { label: "Tài khoản", icon: CircleUserRound, path: "/profile", active: true },
  ];
  return <nav className={mobile ? "profile-bottom-nav" : "profile-side-nav"} aria-label="Điều hướng chính">
    {items.map(({ label, icon: Icon, path, active }) => <button type="button" key={path}
      className={active ? "active" : ""} aria-current={active ? "page" : undefined}
      onClick={() => navigate(path)}><Icon /><span>{label}</span></button>)}
  </nav>;
}

function ProfileAvatar({ src, name, small = false }: { src?: string | null; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`profile-avatar ${small ? "small" : ""}`} aria-hidden="true">
    {src && !failed
      ? <img src={resolveMediaUrl(src) ?? undefined} alt="" onError={() => setFailed(true)} />
      : <span>{name.trim().charAt(0).toUpperCase() || "K"}</span>}
  </span>;
}

function SettingToggle({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return <label className="profile-switch" aria-label={label}>
    <input type="checkbox" checked={checked} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />
    <span />
  </label>;
}

export default function ProfileScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const { setTheme } = useTheme();
  const [name, setName] = useState(user?.display_name ?? "");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([usersApi.getMe(), usersApi.getSettings()]).then(([profile, preferences]) => {
      if (!active) return;
      setUser(profile);
      setName(profile.display_name);
      setSettings(preferences);
    }).catch(() => { if (active) setError("Không tải được hồ sơ hoặc cài đặt."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [setUser]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!value || value.length > 100 || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setUser(await usersApi.updateMe({ display_name: value }));
      setEditingName(false);
      setNotice("Đã lưu tên hiển thị.");
    } catch { setError("Không thể lưu tên hiển thị."); }
    finally { setBusy(false); }
  }

  async function saveSetting(fields: Partial<UserSettings>) {
    if (busy || !settings) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (fields.theme) {
        await setTheme(fields.theme);
        setSettings((current) => current ? { ...current, theme: fields.theme! } : current);
      } else {
        setSettings(await usersApi.updateSettings(fields));
      }
      setNotice("Đã lưu cài đặt.");
    } catch { setError("Không thể lưu cài đặt."); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || busy || !window.confirm("Xóa tài khoản và dữ liệu của bạn? Hành động này không thể hoàn tác.")) return;
    setBusy(true); setError("");
    try {
      await usersApi.deleteMe(password);
      await logout();
      navigate("/welcome", { replace: true });
    } catch { setError("Không thể xóa tài khoản. Kiểm tra mật khẩu và thử lại."); }
    finally { setBusy(false); }
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    navigate("/welcome", { replace: true });
  }

  const displayName = user?.display_name ?? "Kokoro member";

  return <main className="dark profile-shell">
    <aside className="profile-sidebar">
      <button className="profile-brand" type="button" onClick={() => navigate("/home")} aria-label="Kokoro - Trang chủ"><img src={kokoroLogo} alt="" /></button>
      <ProfileNavigation />
      <button className="profile-nav-avatar" type="button" aria-label="Tài khoản hiện tại"><ProfileAvatar src={user?.avatar_url} name={displayName} small /></button>
    </aside>

    <section className="profile-page">
      <header className="profile-heading"><span>KOKORO</span><h1>Tài khoản</h1></header>

      {loading && <div className="profile-loading" role="status"><LoaderCircle /> Đang tải hồ sơ…</div>}
      <div className="profile-feedback" aria-live="polite">
        {error && <p className="profile-error" role="alert"><X />{error}</p>}
        {notice && <p className="profile-notice"><Save />{notice}</p>}
      </div>

      <div className="profile-content">
        <section className="profile-identity" aria-label="Thông tin hồ sơ">
          <ProfileAvatar src={user?.avatar_url} name={displayName} />
          <div className="profile-name-line">
            <h2>{displayName}</h2>
            <button type="button" onClick={() => { setEditingName(true); setName(displayName); }} aria-label="Đổi tên hiển thị"><Pencil /></button>
          </div>
          {user?.username && <p className="profile-username">@{user.username}</p>}
          <p className="profile-email">{user?.email}</p>
          <p className="profile-bio">Trò chuyện, gọi video và tạo video với avatar của riêng bạn.</p>

          <div className="profile-avatar-actions">
            <button type="button" onClick={() => navigate("/avatar/edit/setup")}><Image /> Chỉnh sửa avatar</button>
          </div>

          {editingName && <form className="profile-name-form" onSubmit={(event) => void saveName(event)}>
            <label htmlFor="profile-display-name">Tên hiển thị</label>
            <div><input id="profile-display-name" value={name} maxLength={100} required autoFocus onChange={(event) => setName(event.target.value)} /><button type="submit" disabled={busy || !name.trim() || name.trim() === displayName}><Save /> Lưu</button></div>
            <button className="cancel-name-edit" type="button" onClick={() => { setEditingName(false); setName(displayName); }}>Hủy</button>
          </form>}
        </section>

        <section className="profile-settings" aria-label="Cài đặt tài khoản">
          <div className="profile-setting-row profile-account-row">
            <span className="setting-icon"><UserRound /></span>
            <span className="setting-copy"><strong>Thông tin tài khoản</strong><small>{user?.email}</small></span>
            <span className="account-state">Đang hoạt động</span>
          </div>

          <div className="profile-setting-row">
            <span className="setting-icon"><Search /></span>
            <span className="setting-copy"><strong>Cho phép tìm qua email</strong><small>Người khác có thể tìm thấy bạn bằng email.</small></span>
            <SettingToggle label="Cho phép tìm qua email" checked={settings?.discoverable ?? false} disabled={!settings || busy} onChange={(checked) => void saveSetting({ discoverable: checked })} />
          </div>

          <div className="profile-setting-row">
            <span className="setting-icon"><ShieldCheck /></span>
            <span className="setting-copy"><strong>Cho phép tìm qua @username</strong><small>Kiểm soát khả năng khám phá tài khoản.</small></span>
            <SettingToggle label="Cho phép tìm qua username" checked={settings?.username_searchable ?? false} disabled={!settings || busy || !user?.username} onChange={(checked) => void saveSetting({ username_searchable: checked })} />
          </div>

          <div className="profile-setting-row">
            <span className="setting-icon"><Bell /></span>
            <span className="setting-copy"><strong>Thông báo email</strong><small>Nhận cập nhật quan trọng từ Kokoro.</small></span>
            <SettingToggle label="Thông báo email" checked={settings?.email_notifications ?? false} disabled={!settings || busy} onChange={(checked) => void saveSetting({ email_notifications: checked })} />
          </div>

          <div className="profile-setting-row">
            <span className="setting-icon"><MonitorCog /></span>
            <span className="setting-copy"><strong>Giao diện</strong><small>Chọn cách Kokoro hiển thị trên thiết bị.</small></span>
            <select value={settings?.theme ?? "system"} disabled={!settings || busy} onChange={(event) => void saveSetting({ theme: event.target.value as UserSettings["theme"] })} aria-label="Giao diện">
              <option value="system">Hệ thống</option><option value="dark">Tối</option><option value="light">Sáng</option>
            </select>
          </div>

          <button className={`profile-danger-toggle ${dangerOpen ? "open" : ""}`} type="button" onClick={() => setDangerOpen((value) => !value)} aria-expanded={dangerOpen}>
            <span className="setting-icon"><Database /></span>
            <span className="setting-copy"><strong>Dữ liệu tài khoản</strong><small>Xóa vĩnh viễn tài khoản và dữ liệu.</small></span>
            <ChevronDown />
          </button>
          {dangerOpen && <form className="profile-delete-form" onSubmit={(event) => void deleteAccount(event)}>
            <p>Thao tác này không thể hoàn tác. Nhập mật khẩu để xác nhận.</p>
            <div><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mật khẩu hiện tại" required /><button type="submit" disabled={busy || !password}><Trash2 /> Xóa tài khoản</button></div>
          </form>}

          <button className="profile-logout" type="button" disabled={busy} onClick={() => void handleLogout()}><LogOut /> Đăng xuất</button>
        </section>
      </div>
    </section>
    <ProfileNavigation mobile />
  </main>;
}
