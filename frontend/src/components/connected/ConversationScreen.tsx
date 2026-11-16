import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { conversationsApi } from "../../lib/api";
import type { ConversationSummary, Message } from "../../lib/api/types";
import { useAuthStore } from "../../lib/store/authStore";
import { connectMessagingWS, onMessage, onStatusChange } from "../../lib/ws/messagingWS";
import ConnectedLayout from "./ConnectedLayout";

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    a.client_timestamp.localeCompare(b.client_timestamp) || a.id.localeCompare(b.id));
}

export default function ConversationScreen() {
  const { conversationId } = useParams();
  const userId = useAuthStore((state) => state.user?.id);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const pendingMessageRef = useRef<{ id: string; content: string; client_timestamp: string } | null>(null);

  const refreshLatest = useCallback(async () => {
    if (!conversationId) return;
    const response = await conversationsApi.listMessages(conversationId, { limit: 30 });
    if (!aliveRef.current) return;
    setMessages((current) => mergeMessages(current, response.data));
    setCursor((previous) => previous ?? response.prev_cursor);
    setHasMore((previous) => previous || response.has_more);
  }, [conversationId]);

  useEffect(() => {
    aliveRef.current = true;
    if (!conversationId) return;
    setLoading(true); setError(""); setMessages([]); setCursor(null); setHasMore(false);
    void Promise.all([
      conversationsApi.getConversation(conversationId),
      conversationsApi.listMessages(conversationId, { limit: 30 }),
    ]).then(([detail, history]) => {
      if (!aliveRef.current) return;
      setConversation(detail); setMessages((current) => mergeMessages(current, history.data));
      setCursor(history.prev_cursor); setHasMore(history.has_more);
    }).catch(() => { if (aliveRef.current) setError("Không thể tải cuộc trò chuyện."); })
      .finally(() => { if (aliveRef.current) setLoading(false); });

    const offMessage = onMessage("NEW_MESSAGE", (data) => {
      const incoming = data as Message;
      if (incoming?.conversation_id !== conversationId || !incoming.id) return;
      setMessages((current) => mergeMessages(current, [incoming]));
      if (incoming.sender_id !== userId) {
        void conversationsApi.updateMessageStatus(conversationId, incoming.id, "read").catch(() => {});
      }
    });
    const offStatus = onMessage("MESSAGE_STATUS_UPDATE", (data) => {
      const update = data as { id?: string; status?: Message["status"] };
      if (!update?.id || !update.status) return;
      setMessages((current) => current.map((message) => message.id === update.id ? { ...message, status: update.status! } : message));
    });
    const offConnection = onStatusChange((status) => {
      if (status === "open") void refreshLatest().catch(() => {});
    });
    connectMessagingWS();
    const onVisible = () => { if (document.visibilityState === "visible") void refreshLatest().catch(() => {}); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      offMessage(); offStatus(); offConnection();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [conversationId, refreshLatest, userId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function loadOlder() {
    if (!conversationId || !cursor || paging) return;
    setPaging(true); setError("");
    try {
      const response = await conversationsApi.listMessages(conversationId, { cursor, limit: 30 });
      if (!aliveRef.current) return;
      setMessages((current) => mergeMessages(current, response.data));
      setCursor(response.prev_cursor); setHasMore(response.has_more);
    } catch { if (aliveRef.current) setError("Không thể tải tin nhắn cũ."); }
    finally { if (aliveRef.current) setPaging(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!conversationId || !content || content.length > 4000 || sending) return;
    setSending(true); setError("");
    const message = pendingMessageRef.current?.content === content
      ? pendingMessageRef.current
      : { id: crypto.randomUUID(), content, client_timestamp: new Date().toISOString() };
    pendingMessageRef.current = message;
    try {
      const saved = await conversationsApi.sendMessage(conversationId, message);
      if (!aliveRef.current) return;
      setMessages((current) => mergeMessages(current, [saved]));
      setDraft("");
      pendingMessageRef.current = null;
    } catch { if (aliveRef.current) setError("Không gửi được tin nhắn. Nội dung vẫn được giữ để bạn thử lại."); }
    finally { if (aliveRef.current) setSending(false); }
  }

  return <ConnectedLayout title={conversation?.other_user.display_name ?? "Trò chuyện"}>
    <section className="connected-card connected-chat">
      {loading && <p role="status">Đang tải tin nhắn…</p>}
      {error && <p className="connected-error" role="alert">{error}</p>}
      {!loading && !conversation && <button type="button" onClick={() => window.location.reload()}>Thử lại</button>}
      {conversation && <>
        {hasMore && <button type="button" disabled={paging} onClick={() => void loadOlder()}>{paging ? "Đang tải…" : "Tải tin nhắn cũ"}</button>}
        <div className="connected-messages" aria-live="polite">
          {messages.length === 0 && <p className="connected-muted">Chưa có tin nhắn. Hãy gửi lời chào đầu tiên.</p>}
          {messages.map((message) => <div key={message.id} className={`connected-message ${message.sender_id === userId ? "own" : ""}`}>
            {message.content}<small>{new Date(message.client_timestamp).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}{message.sender_id === userId ? ` · ${message.status}` : ""}</small>
          </div>)}
          <div ref={endRef} />
        </div>
        <form className="connected-compose" onSubmit={(event) => void send(event)}>
          <textarea aria-label="Tin nhắn" maxLength={4000} value={draft} onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim() !== pendingMessageRef.current?.content) pendingMessageRef.current = null; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Viết tin nhắn…" />
          <button className="connected-primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "Đang gửi…" : "Gửi"}</button>
        </form>
      </>}
    </section>
  </ConnectedLayout>;
}
