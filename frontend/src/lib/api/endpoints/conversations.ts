import { request } from "../client";
import type { ConversationSummary, Message, Paginated } from "../types";

export function createOrGetConversation(otherUserId: string) {
  return request<ConversationSummary>("/conversations", {
    method: "POST",
    body: { other_user_id: otherUserId },
  });
}

export function listConversations(params?: { cursor?: string; limit?: number }) {
  return request<Paginated<ConversationSummary>>("/conversations", { query: params });
}

export function getConversation(id: string) {
  return request<ConversationSummary>(`/conversations/${id}`);
}

export function listMessages(conversationId: string, params?: { cursor?: string; limit?: number }) {
  return request<{ data: Message[]; prev_cursor: string | null; has_more: boolean }>(
    `/conversations/${conversationId}/messages`,
    { query: params },
  );
}

export function sendMessage(
  conversationId: string,
  message: { id: string; content: string; client_timestamp: string },
) {
  return request<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: message,
  });
}

export function updateMessageStatus(
  conversationId: string,
  messageId: string,
  status: "delivered" | "read",
) {
  return request<{ id: string; status: string; updated_at: string }>(
    `/conversations/${conversationId}/messages/${messageId}`,
    { method: "PUT", body: { status } },
  );
}
