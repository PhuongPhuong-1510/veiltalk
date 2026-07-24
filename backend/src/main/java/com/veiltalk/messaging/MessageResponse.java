package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MessageResponse(
		UUID id,
		@JsonProperty("conversation_id") UUID conversationId,
		@JsonProperty("sender_id") UUID senderId,
		String content,
		String status,
		@JsonProperty("client_timestamp") Instant clientTimestamp,
		@JsonProperty("created_at") Instant createdAt) {

	public static MessageResponse from(Message message) {
		return new MessageResponse(
				message.getId(),
				message.getConversationId(),
				message.getSenderId(),
				message.getContent(),
				message.getStatus().getDatabaseValue(),
				message.getClientTimestamp(),
				message.getCreatedAt());
	}
}
