import {
  CircleUserRound, Clock3, Film, LoaderCircle, MessageCircle, Search, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { kokoroLogo } from "../../assets";
import { usersApi, conversationsApi, ApiError } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { resolveMediaUrl } from "../../lib/api/client";
import "./searchScreen.css";

type FoundUser = { id: string; username?: string; display_name: string; avatar_url?: string | null };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^@?[a-zA-Z0-9._]{3,30}$/;

function SearchNavigation({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate();
  const items = [
    { label: "Trò chuyện", icon: MessageCircle, path: "/home" },
    { label: "Video", icon: Film, path: "/videos" },
    { label: "Tài khoản", icon: CircleUserRound, path: "/profile" },
  ];
  return <nav className={mobile ? "search-bottom-nav" : "search-side-nav"} aria-label="Điều hướng chính">
    {items.map(({ label, icon: Icon, path }) => <button key={path} type="button" onClick={() => navigate(path)}><Icon /><span>{label}</span></button>)}
  </nav>;
}

function SearchAvatar({ src, name, small = false }: { src?: string | null; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`search-avatar ${small ? "small" : ""}`} aria-hidden="true">
    {src && !failed ? <img src={resolveMediaUrl(src) ?? undefined} alt="" onError={() => setFailed(true)} /> : <span>{name.trim().charAt(0).toUpperCase() || "K"}</span>}
  </span>;
}

export default function SearchScreen() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
  const currentUserId = currentUser?.id ?? "anonymous";
  const historyKey = `veiltalk-user-search-history:${currentUserId}`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [startingUserId, setStartingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [rateLimitDeadline, setRateLimitDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(historyKey) ?? "[]") as string[]; }
    catch { return []; }
  });
  const requestSequence = useRef(0);

  const trimmed = query.trim();
  const isEmail = EMAIL_PATTERN.test(trimmed);
  const usernameQuery = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const isUsername = !trimmed.includes("@") || trimmed.startsWith("@");
  const validUsernameQuery = isUsername && USERNAME_PATTERN.test(trimmed);
  const retryAfterSeconds = Math.max(0, Math.ceil((rateLimitDeadline - now) / 1000));
  const visibleHistory = useMemo(() => query ? [] : history, [history, query]);

  const rememberQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setHistory((current) => {
      const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 5);
      localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  }, [historyKey]);

  const handleSearchError = useCallback((reason: unknown) => {
    if (reason instanceof ApiError && reason.status === 429) {
      const seconds = Math.max(1, reason.retryAfterSeconds ?? 60);
      setNow(Date.now()); setRateLimitDeadline(Date.now() + seconds * 1000);
      setError(`Bạn tìm quá nhanh. Thử lại sau ${seconds} giây.`);
    } else setError("Không thể tìm người dùng. Vui lòng thử lại.");
    setResults([]); setSearched(false);
  }, []);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (!validUsernameQuery || retryAfterSeconds > 0) {
      if (!isEmail) { setResults([]); setSearched(false); }
      return;
    }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true); setError("");
      try {
        const response = await usersApi.searchUsernames(usernameQuery, controller.signal);
        if (sequence !== requestSequence.current) return;
        setResults(response.data); setSearched(true); setSelectedIndex(response.data.length ? 0 : -1);
        rememberQuery(trimmed);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (sequence === requestSequence.current) handleSearchError(reason);
      } finally { if (sequence === requestSequence.current) setSearchLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmed, usernameQuery, validUsernameQuery, isEmail, retryAfterSeconds, rememberQuery, handleSearchError]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchLoading || retryAfterSeconds > 0) return;
    if (isEmail) {
      setSearchLoading(true); setError(""); setResults([]); setSearched(false);
      try {
        const response = await usersApi.searchUsers(trimmed);
        setResults(response.found && response.user ? [response.user] : []);
        setSearched(true); rememberQuery(trimmed);
      } catch (reason) { handleSearchError(reason); }
      finally { setSearchLoading(false); }
    } else if (!validUsernameQuery) {
      setError(trimmed.includes("@")
        ? "Email không hợp lệ. Vui lòng kiểm tra lại."
        : "Username cần ít nhất 3 ký tự và chỉ gồm a–z, 0–9, dấu chấm hoặc gạch dưới.");
    }
  }

  async function startConversation(user: FoundUser) {
    if (startingUserId) return;
    setStartingUserId(user.id); setError("");
    try {
      const conversation = await conversationsApi.createOrGetConversation(user.id);
      navigate(`/home?conversation=${encodeURIComponent(conversation.id)}`);
    } catch { setError("Không thể mở cuộc trò chuyện. Vui lòng thử lại."); }
    finally { setStartingUserId(null); }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((current) => (current + 1) % results.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((current) => (current - 1 + results.length) % results.length); }
    else if (event.key === "Enter" && selectedIndex >= 0 && !isEmail) { event.preventDefault(); void startConversation(results[selectedIndex]); }
    else if (event.key === "Escape") { setResults([]); setSearched(false); setSelectedIndex(-1); }
  }

  function removeHistory(item: string) {
    setHistory((current) => {
      const next = current.filter((entry) => entry !== item);
      localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  }

  return <main className="dark user-search-shell">
    <aside className="search-sidebar">
      <button className="search-brand" type="button" onClick={() => navigate("/home")} aria-label="Kokoro - Trang chủ"><img src={kokoroLogo} alt="" /></button>
      <SearchNavigation />
      <button className="search-profile" type="button" onClick={() => navigate("/profile")} aria-label="Mở tài khoản"><SearchAvatar src={currentUser?.avatar_url} name={currentUser?.display_name ?? "Kokoro"} small /></button>
    </aside>

    <section className="user-search-column">
      <header className="user-search-heading"><span>KOKORO</span><h1>Tìm kiếm</h1></header>
      <form className="user-search-form" onSubmit={(event) => void submitSearch(event)}>
        <Search />
        <input id="user-search" autoFocus role="combobox" aria-label="Username hoặc email" aria-autocomplete="list"
          aria-expanded={results.length > 0} aria-controls="user-search-results"
          aria-activedescendant={selectedIndex >= 0 ? `user-search-result-${selectedIndex}` : undefined}
          value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }}
          onKeyDown={onInputKeyDown} placeholder="Username hoặc email…" />
        {query && <button className="clear-user-search" type="button" onClick={() => { setQuery(""); setResults([]); setSearched(false); setError(""); }} aria-label="Xóa tìm kiếm"><X /></button>}
        <button className="submit-user-search" type="submit" disabled={searchLoading || retryAfterSeconds > 0} aria-label="Tìm kiếm">{searchLoading ? <LoaderCircle /> : <Search />}</button>
      </form>

      {retryAfterSeconds > 0 && <p className="search-inline-status" role="status">Thử lại sau {retryAfterSeconds} giây.</p>}
      {error && <p className="user-search-error" role="alert">{error}</p>}

      {visibleHistory.length > 0 && <section className="recent-searches" aria-label="Tìm kiếm gần đây">
        <div><span><Clock3 /> Tìm kiếm gần đây</span><small>{visibleHistory.length}</small></div>
        {visibleHistory.map((item) => <div className="recent-search-row" key={item}>
          <button type="button" className="recent-search-value" onClick={() => setQuery(item)}><Search /><span>{item}</span></button>
          <button type="button" className="remove-recent-search" aria-label={`Xóa ${item} khỏi lịch sử`} onClick={() => removeHistory(item)}><X /></button>
        </div>)}
      </section>}

      {searched && <div className="search-result-summary">Kết quả tìm kiếm người dùng <span>· {results.length}</span></div>}
      {searched && !results.length && <div className="no-user-results"><Search /><strong>Không tìm thấy người dùng</strong><span>Kiểm tra lại username hoặc email rồi thử lại.</span></div>}
      <div className="user-result-list" id="user-search-results" role="listbox" aria-label="Kết quả tìm kiếm">
        {results.map((result, index) => <div className={`user-result-row ${selectedIndex === index ? "selected" : ""}`} id={`user-search-result-${index}`} role="option" aria-selected={selectedIndex === index} key={result.id}>
          <SearchAvatar src={result.avatar_url} name={result.display_name} />
          <div><strong>{result.display_name}</strong><small>{result.username ? `@${result.username}` : "Tìm thấy qua email"}</small></div>
          <button type="button" onClick={() => void startConversation(result)} disabled={startingUserId !== null}>
            {startingUserId === result.id ? <LoaderCircle /> : <MessageCircle />}<span>{startingUserId === result.id ? "Đang mở…" : "Nhắn tin"}</span>
          </button>
        </div>)}
      </div>
    </section>

    <section className="user-search-preview">
      <span><Search /></span>
      <h2>{results.length ? "Bắt đầu trò chuyện" : "Tìm người dùng"}</h2>
      <p>{results.length ? "Chọn Nhắn tin để mở cuộc trò chuyện ngay trong Home." : "Nhập username hoặc email để tìm và bắt đầu trò chuyện."}</p>
    </section>
    <SearchNavigation mobile />
  </main>;
}
