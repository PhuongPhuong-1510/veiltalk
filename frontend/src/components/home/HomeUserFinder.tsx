import { Clock3, LoaderCircle, MessageCircle, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, conversationsApi, usersApi } from "../../lib/api";
import type { ConversationSummary } from "../../lib/api/types";
import { useAuthStore } from "../../lib/store/authStore";
import { resolveMediaUrl } from "../../lib/api/client";

type FoundUser = { id: string; username?: string; display_name: string; avatar_url?: string | null };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^@?[a-zA-Z0-9._]{3,30}$/;

function FinderAvatar({ user }: { user: FoundUser }) {
  const [failed, setFailed] = useState(false);
  return <span className="finder-avatar" aria-hidden="true">
    {user.avatar_url && !failed
      ? <img src={resolveMediaUrl(user.avatar_url) ?? undefined} alt="" onError={() => setFailed(true)} />
      : <span>{user.display_name.trim().charAt(0).toUpperCase() || "K"}</span>}
  </span>;
}

export default function HomeUserFinder({ onConversationCreated }: {
  onConversationCreated: (conversation: ConversationSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const currentUserId = useAuthStore((state) => state.user?.id ?? "anonymous");
  const historyKey = `veiltalk-user-search-history:${currentUserId}`;
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(historyKey) ?? "[]");
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
    } catch { return []; }
  });
  const requestSequence = useRef(0);
  const trimmed = query.trim();
  const isEmail = EMAIL_PATTERN.test(trimmed);
  const usernameQuery = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const validUsername = (!trimmed.includes("@") || trimmed.startsWith("@")) && USERNAME_PATTERN.test(trimmed);

  const rememberQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setHistory((current) => {
      const next = [normalized, ...current.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase())].slice(0, 5);
      localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  }, [historyKey]);

  const showSearchError = useCallback((reason: unknown) => {
    setResults([]);
    setSearched(false);
    if (reason instanceof ApiError && reason.status === 429) {
      const seconds = Math.max(1, reason.retryAfterSeconds ?? 60);
      setRetryAfter(seconds);
      setError(`Bạn tìm quá nhanh. Có thể thử lại sau ${seconds} giây.`);
    } else setError("Không thể tìm người dùng. Vui lòng thử lại.");
  }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  useEffect(() => {
    if (retryAfter > 0) setError(`Bạn tìm quá nhanh. Có thể thử lại sau ${retryAfter} giây.`);
    else setError((current) => current.startsWith("Bạn tìm quá nhanh") ? "" : current);
  }, [retryAfter]);

  useEffect(() => {
    if (!validUsername || isEmail || retryAfter > 0) {
      if (!isEmail) { setResults([]); setSearched(false); }
      return;
    }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await usersApi.searchUsernames(usernameQuery, controller.signal);
        if (sequence !== requestSequence.current) return;
        setResults(response.data); setSearched(true);
        rememberQuery(trimmed);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (sequence === requestSequence.current) showSearchError(reason);
      } finally { if (sequence === requestSequence.current) setLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isEmail, rememberQuery, retryAfter, showSearchError, trimmed, usernameQuery, validUsername]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || retryAfter > 0) return;
    if (!isEmail) {
      if (!validUsername) setError("Nhập ít nhất 3 ký tự của username hoặc một email hợp lệ.");
      return;
    }
    setLoading(true); setError(""); setResults([]);
    try {
      const response = await usersApi.searchUsers(trimmed);
      setResults(response.found && response.user ? [response.user] : []);
      setSearched(true);
      rememberQuery(trimmed);
    } catch (reason) { showSearchError(reason); }
    finally { setLoading(false); }
  }

  function removeHistory(value: string) {
    setHistory((current) => {
      const next = current.filter((item) => item !== value);
      localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  }

  async function startConversation(user: FoundUser) {
    if (startingId) return;
    setStartingId(user.id); setError("");
    try {
      onConversationCreated(await conversationsApi.createOrGetConversation(user.id));
    } catch { setError("Không thể mở cuộc trò chuyện. Vui lòng thử lại."); }
    finally { setStartingId(null); }
  }

  return <div className="home-user-finder">
    <form className="finder-search" onSubmit={(event) => void submit(event)}>
      <Search />
      <input autoFocus value={query} disabled={retryAfter > 0} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="Username hoặc email…" aria-label="Tìm người dùng" />
      {query && <button type="button" onClick={() => { setQuery(""); setResults([]); setSearched(false); setError(""); }} aria-label="Xóa tìm kiếm"><X /></button>}
    </form>
    <p className="finder-hint">Nhập @username hoặc email chính xác để bắt đầu trò chuyện.</p>
    {!trimmed && history.length > 0 && <section className="finder-history" aria-label="Tìm kiếm gần đây">
      <header><span><Clock3 /> Tìm kiếm gần đây</span><small>{history.length}/5</small></header>
      {history.map((item) => <div className="finder-history-row" key={item}>
        <button type="button" className="finder-history-value" onClick={() => { setQuery(item); setError(""); }}><Search /><span>{item}</span></button>
        <button type="button" className="finder-history-remove" onClick={() => removeHistory(item)} aria-label={`Xóa ${item} khỏi lịch sử`}><Trash2 /></button>
      </div>)}
    </section>}
    {loading && <div className="finder-loading"><LoaderCircle /> Đang tìm…</div>}
    {error && <p className="finder-error" role="alert">{error}</p>}
    {searched && !loading && <div className="finder-summary">Kết quả tìm kiếm <span>· {results.length}</span></div>}
    {searched && !loading && results.length === 0 && <div className="finder-empty"><Search /><strong>Không tìm thấy người dùng</strong><span>Kiểm tra lại thông tin rồi thử lần nữa.</span></div>}
    <div className="finder-results">
      {results.map((result) => <div className="finder-result" key={result.id}>
        <FinderAvatar user={result} />
        <div><strong>{result.display_name}</strong><small>{result.username ? `@${result.username}` : "Tìm thấy qua email"}</small></div>
        <button type="button" disabled={startingId !== null} onClick={() => void startConversation(result)} aria-label={`Nhắn tin với ${result.display_name}`}>
          {startingId === result.id ? <LoaderCircle /> : <MessageCircle />}<span>{startingId === result.id ? "Đang mở" : "Nhắn tin"}</span>
        </button>
      </div>)}
    </div>
  </div>;
}
