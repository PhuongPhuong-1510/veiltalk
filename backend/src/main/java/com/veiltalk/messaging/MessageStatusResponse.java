package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MessageStatusResponse(
		UUID id,
		String status,
		@JsonProperty("updated_at") Instant updatedAt) {

	public static MessageStatusResponse from(Message message) {
		return new MessageStatusResponse(
				message.getId(),
				message.getStatus().getDatabaseValue(),
				message.getUpdatedAt());
	}
}
