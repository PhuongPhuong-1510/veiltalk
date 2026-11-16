import {
  ArrowLeft, Check, CheckCheck, CircleUserRound, Film, LoaderCircle, MessageCircle,
  Plus, RotateCcw, Search, Send, Video, WifiOff, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { kokoroLogo } from "../../assets";
import { conversationsApi } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/api/client";
import { listConversations } from "../../lib/api/endpoints/conversations";
import type { ConversationSummary, Message } from "../../lib/api/types";
import { useAuthStore } from "../../lib/store/authStore";
import { connectMessagingWS, onMessage, onStatusChange, sendTyping, sendTypingStop } from "../../lib/ws/messagingWS";
import HomeUserFinder from "./HomeUserFinder";
import "./homeScreen.css";

const PAGE_SIZE = 20;

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Hôm qua";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date);
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((a, b) =>
    a.client_timestamp.localeCompare(b.client_timestamp) || a.id.localeCompare(b.id));
}

function StaticAvatar({ src, name, size = "regular" }: {
  src?: string | null;
  name: string;
  size?: "regular" | "small" | "large";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`home-avatar home-avatar--${size}`} aria-hidden="true">
      {src && !failed
        ? <img src={resolveMediaUrl(src) ?? undefined} alt="" onError={() => setFailed(true)} />
        : <span>{name.trim().charAt(0).toUpperCase() || "K"}</span>}
    </span>
  );
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate();
  const items = [
    { label: "Trò chuyện", icon: MessageCircle, path: "/home", active: true },
    { label: "Video", icon: Film, path: "/videos" },
    { label: "Tài khoản", icon: CircleUserRound, path: "/profile" },
  ];
  return (
    <nav className={mobile ? "home-bottom-nav" : "home-side-nav"} aria-label="Điều hướng chính">
      {items.map(({ label, icon: Icon, path, active }) => (
        <button key={path} type="button" className={active ? "active" : ""}
          aria-current={active ? "page" : undefined} onClick={() => navigate(path)}>
          <Icon aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ChatPane({ conversation, onBack, onConversationChange }: {
  conversation: ConversationSummary;
  onBack: () => void;
  onConversationChange: () => void;
}) {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  const [typing, setTyping] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "open" | "reconnecting" | "closed">("closed");
  const endRef = useRef<HTMLDivElement>(null);
  const typingStopTimer = useRef<number | null>(null);
  const remoteTypingTimer = useRef<number | null>(null);

  const loadLatest = useCallback(async () => {
    const response = await conversationsApi.listMessages(conversation.id, { limit: 30 });
    setMessages((current) => mergeMessages(current, response.data));
    setCursor((current) => current ?? response.prev_cursor);
    setHasMore(response.has_more);
  }, [conversation.id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setMessages([]);
    setCursor(null);
    void conversationsApi.listMessages(conversation.id, { limit: 30 })
      .then((response) => {
        if (!alive) return;
        setMessages(response.data);
        setCursor(response.prev_cursor);
        setHasMore(response.has_more);
        const unread = [...response.data].reverse().find((message) => message.sender_id !== userId && message.status !== "read");
        if (unread) void conversationsApi.updateMessageStatus(conversation.id, unread.id, "read").catch(() => {});
      })
      .catch(() => alive && setError("Không thể tải tin nhắn."))
      .finally(() => alive && setLoading(false));

    const offMessage = onMessage("NEW_MESSAGE", (data) => {
      const incoming = data as Message;
      if (!alive || incoming?.conversation_id !== conversation.id || !incoming.id) return;
      setMessages((current) => mergeMessages(current, [incoming]));
      onConversationChange();
      if (incoming.sender_id !== userId) {
        void conversationsApi.updateMessageStatus(conversation.id, incoming.id, "read").catch(() => {});
      }
    });
    const offStatus = onMessage("MESSAGE_STATUS_UPDATE", (data) => {
      const update = data as { id?: string; status?: Message["status"] };
      if (!update.id || !update.status) return;
      setMessages((current) => current.map((message) =>
        message.id === update.id ? { ...message, status: update.status! } : message));
    });
    const offTyping = onMessage("TYPING", (data) => {
      const event = data as { conversation_id?: string };
      if (event.conversation_id !== conversation.id) return;
      setTyping(true);
      if (remoteTypingTimer.current !== null) window.clearTimeout(remoteTypingTimer.current);
      remoteTypingTimer.current = window.setTimeout(() => setTyping(false), 3500);
    });
    const offTypingStop = onMessage("TYPING_STOP", (data) => {
      const event = data as { conversation_id?: string };
      if (event.conversation_id === conversation.id) setTyping(false);
    });
    const offConnection = onStatusChange((status) => {
      setConnectionStatus(status);
      if (status === "open") void loadLatest().catch(() => {});
    });
    connectMessagingWS();
    return () => {
      alive = false; offMessage(); offStatus(); offTyping(); offTypingStop(); offConnection();
      sendTypingStop(conversation.id);
      if (typingStopTimer.current !== null) window.clearTimeout(typingStopTimer.current);
      if (remoteTypingTimer.current !== null) window.clearTimeout(remoteTypingTimer.current);
    };
  }, [conversation.id, loadLatest, onConversationChange, userId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, typing]);

  async function loadOlder() {
    if (!cursor || paging) return;
    setPaging(true);
    try {
      const response = await conversationsApi.listMessages(conversation.id, { cursor, limit: 30 });
      setMessages((current) => mergeMessages(current, response.data));
      setCursor(response.prev_cursor);
      setHasMore(response.has_more);
    } catch { setError("Không thể tải tin nhắn cũ."); }
    finally { setPaging(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      const saved = await conversationsApi.sendMessage(conversation.id, {
        id: crypto.randomUUID(), content, client_timestamp: new Date().toISOString(),
      });
      setMessages((current) => mergeMessages(current, [saved]));
      setDraft("");
      sendTypingStop(conversation.id);
      onConversationChange();
    } catch { setError("Không gửi được tin nhắn. Hãy thử lại."); }
    finally { setSending(false); }
  }

  function changeDraft(value: string) {
    setDraft(value);
    if (connectionStatus === "open" && value.trim()) sendTyping(conversation.id);
    if (typingStopTimer.current !== null) window.clearTimeout(typingStopTimer.current);
    typingStopTimer.current = window.setTimeout(() => sendTypingStop(conversation.id), 1200);
  }

  return (
    <section className="home-chat" aria-label={`Trò chuyện với ${conversation.other_user.display_name}`}>
      <header className="chat-header">
        <button className="chat-back" type="button" onClick={onBack} aria-label="Quay lại danh sách"><ArrowLeft /></button>
        <StaticAvatar src={conversation.other_user.avatar_url} name={conversation.other_user.display_name} />
        <div className="chat-person"><strong>{conversation.other_user.display_name}</strong></div>
        <div className="chat-actions">
          <button type="button" onClick={() => navigate(`/calls/new?user=${encodeURIComponent(conversation.other_user.id)}`)} aria-label="Gọi video"><Video /></button>
        </div>
      </header>

      <div className="chat-messages" aria-live="polite">
        {hasMore && <button className="load-older" type="button" disabled={paging} onClick={() => void loadOlder()}>{paging ? "Đang tải…" : "Xem tin nhắn cũ"}</button>}
        {loading && <div className="chat-loading"><LoaderCircle /> Đang tải tin nhắn…</div>}
        {error && <p className="chat-error" role="alert">{error}</p>}
        {!loading && messages.length === 0 && (
          <div className="chat-first-message"><StaticAvatar src={conversation.other_user.avatar_url} name={conversation.other_user.display_name} size="large" /><strong>{conversation.other_user.display_name}</strong><span>Hãy gửi một lời chào để bắt đầu cuộc trò chuyện.</span></div>
        )}
        {messages.map((message) => {
          const own = message.sender_id === userId;
          return (
            <div className={`message-line ${own ? "own" : ""}`} key={message.id}>
              {!own && <StaticAvatar src={conversation.other_user.avatar_url} name={conversation.other_user.display_name} size="small" />}
              <div><p>{message.content}</p><time>{formatConversationTime(message.client_timestamp)}{own && <span className={`message-status status-${message.status}`}>{message.status === "read" ? <CheckCheck /> : <Check />}{message.status === "read" ? "Đã xem" : message.status === "delivered" ? "Đã nhận" : "Đã gửi"}</span>}</time></div>
            </div>
          );
        })}
        {typing && (
          <div className="chat-typing-indicator" role="status" aria-label={`${conversation.other_user.display_name} đang nhập`}>
            <StaticAvatar src={conversation.other_user.avatar_url} name={conversation.other_user.display_name} size="small" />
            <span className="typing-bubble" aria-hidden="true"><i /><i /><i /></span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-compose" onSubmit={(event) => void sendMessage(event)}>
        <label>
          <span className="sr-only">Tin nhắn</span>
          <textarea value={draft} maxLength={4000} rows={1} placeholder="Nhập tin nhắn…"
            onChange={(event) => changeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          <span className="compose-limit">{draft.length > 3600 ? `${draft.length}/4000` : ""}</span>
        </label>
        <button className="send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Gửi tin nhắn"><Send /></button>
      </form>
    </section>
  );
}

function EmptyChat() {
  return (
    <section className="home-empty-chat">
      <span className="empty-chat-icon"><MessageCircle /></span>
      <h2>Tin nhắn của bạn</h2>
      <p>Chọn một cuộc trò chuyện để bắt đầu nhắn tin.</p>
    </section>
  );
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState<ConversationSummary | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("conversation"));
  const requestInFlight = useRef(false);

  const loadConversations = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await listConversations({ limit: PAGE_SIZE });
      setConversations([...response.data].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
      setNextCursor(response.next_cursor);
      setHasMoreConversations(response.has_more);
      setError("");
    } catch { setError("Kokoro chưa thể tải danh sách trò chuyện."); }
    finally { setLoading(false); requestInFlight.current = false; }
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { setSelectedId(searchParams.get("conversation")); }, [searchParams]);
  useEffect(() => {
    if (!selectedId || conversations.some((item) => item.id === selectedId)) {
      setSelectedRemote(null);
      return;
    }
    let active = true;
    setSelectedLoading(true);
    void conversationsApi.getConversation(selectedId)
      .then((detail) => { if (active) setSelectedRemote(detail); })
      .catch(() => { if (active) setError("Không thể mở cuộc trò chuyện này."); })
      .finally(() => { if (active) setSelectedLoading(false); });
    return () => { active = false; };
  }, [conversations, selectedId]);
  useEffect(() => {
    const offMessage = onMessage("NEW_MESSAGE", () => void loadConversations());
    const offStatus = onStatusChange((status) => status === "open" && void loadConversations());
    connectMessagingWS();
    return () => { offMessage(); offStatus(); };
  }, [loadConversations]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    if (!normalized) return conversations;
    return conversations.filter((item) =>
      item.other_user.display_name.toLocaleLowerCase("vi").includes(normalized)
      || item.last_message?.content.toLocaleLowerCase("vi").includes(normalized));
  }, [conversations, query]);
  const selectedConversation = conversations.find((item) => item.id === selectedId) ?? selectedRemote;
  const finderOpen = searchParams.get("find") === "people";

  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    const next = new URLSearchParams(searchParams);
    next.set("conversation", conversationId);
    setSearchParams(next);
  }

  function closeConversation() {
    setSelectedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("conversation");
    setSearchParams(next, { replace: true });
  }

  function openFinder() {
    const next = new URLSearchParams(searchParams);
    next.set("find", "people");
    setSearchParams(next);
  }

  function closeFinder() {
    const next = new URLSearchParams(searchParams);
    next.delete("find");
    setSearchParams(next, { replace: true });
  }

  function handleConversationCreated(conversation: ConversationSummary) {
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    setSelectedId(conversation.id);
    const next = new URLSearchParams(searchParams);
    next.delete("find");
    next.set("conversation", conversation.id);
    setSearchParams(next, { replace: true });
  }

  async function loadMoreConversations() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await listConversations({ cursor: nextCursor, limit: PAGE_SIZE });
      setConversations((current) => [...current, ...response.data.filter((item) => !current.some((old) => old.id === item.id))]);
      setNextCursor(response.next_cursor);
      setHasMoreConversations(response.has_more);
    } catch { setError("Không thể tải thêm cuộc trò chuyện."); }
    finally { setLoadingMore(false); }
  }

  return (
    <main className={`dark home-shell ${selectedConversation ? "has-active-chat" : ""}`}>
      <aside className="home-sidebar">
        <button className="home-brand" type="button" onClick={() => navigate("/home")} aria-label="Kokoro - Trang chủ"><img src={kokoroLogo} alt="" /></button>
        <Navigation />
        <button className="sidebar-profile" type="button" onClick={() => navigate("/profile")} aria-label="Mở tài khoản">
          <StaticAvatar src={user?.avatar_url} name={user?.display_name ?? "Kokoro"} size="small" />
        </button>
      </aside>

      <section className="conversation-column" aria-label="Danh sách cuộc trò chuyện">
        <header className="conversation-heading">
          <div><span>KOKORO</span><h1>{finderOpen ? "Tìm người" : "Trò chuyện"}</h1></div>
          <button type="button" onClick={finderOpen ? closeFinder : openFinder} aria-label={finderOpen ? "Quay lại danh sách trò chuyện" : "Tạo cuộc trò chuyện mới"}>{finderOpen ? <ArrowLeft /> : <Plus />}</button>
        </header>
        {finderOpen ? <HomeUserFinder onConversationCreated={handleConversationCreated} /> : <>
          <label className="conversation-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc trò chuyện…" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm"><X /></button>}</label>

          <div className="conversation-list">
            {loading && <div className="list-loading"><LoaderCircle /> Đang tải cuộc trò chuyện…</div>}
            {!loading && error && <div className="list-error"><WifiOff /><p>{error}</p><button type="button" onClick={() => void loadConversations()}><RotateCcw /> Thử lại</button></div>}
            {!loading && !error && filteredConversations.length === 0 && <div className="list-empty"><MessageCircle /><strong>{query ? "Không tìm thấy cuộc trò chuyện" : "Chưa có cuộc trò chuyện"}</strong><span>{query ? "Thử một tên hoặc nội dung khác." : "Tìm một người bạn để bắt đầu."}</span>{!query && <button type="button" onClick={openFinder}>Bắt đầu trò chuyện</button>}</div>}
            {filteredConversations.map((conversation) => {
              const own = conversation.last_message?.sender_id === user?.id;
              const unread = Boolean(conversation.last_message && !own && conversation.last_message.status !== "read");
              return (
                <button type="button" className={`conversation-row ${selectedId === conversation.id ? "active" : ""}`} key={conversation.id} onClick={() => openConversation(conversation.id)}>
                  <StaticAvatar src={conversation.other_user.avatar_url} name={conversation.other_user.display_name} />
                  <span className="conversation-copy"><span><strong>{conversation.other_user.display_name}</strong><time>{formatConversationTime(conversation.updated_at)}</time></span><span className="message-preview">{own && "Bạn: "}{conversation.last_message?.content ?? "Bắt đầu trò chuyện"}</span></span>
                  {unread && <i className="unread-dot" aria-label="Tin nhắn chưa đọc" />}
                </button>
              );
            })}
            {!query && hasMoreConversations && <button className="conversation-load-more" type="button" disabled={loadingMore || !nextCursor} onClick={() => void loadMoreConversations()}>{loadingMore ? <><LoaderCircle /> Đang tải…</> : "Xem thêm cuộc trò chuyện"}</button>}
          </div>
        </>}
      </section>

      <section className="conversation-workspace">
        {selectedLoading
          ? <div className="chat-loading workspace-loading"><LoaderCircle /> Đang mở cuộc trò chuyện…</div>
          : selectedConversation
          ? <ChatPane conversation={selectedConversation} onBack={closeConversation} onConversationChange={loadConversations} />
          : <EmptyChat />}
      </section>
      <Navigation mobile />
    </main>
  );
}

export { formatConversationTime };
