package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MessageHistoryResponse(
		UUID id,
		@JsonProperty("sender_id") UUID senderId,
		String content,
		String status,
		@JsonProperty("client_timestamp") Instant clientTimestamp,
		@JsonProperty("created_at") Instant createdAt) {

	public static MessageHistoryResponse from(Message message) {
		return new MessageHistoryResponse(
				message.getId(),
				message.getSenderId(),
				message.getContent(),
				message.getStatus().getDatabaseValue(),
				message.getClientTimestamp(),
				message.getCreatedAt());
	}
}
