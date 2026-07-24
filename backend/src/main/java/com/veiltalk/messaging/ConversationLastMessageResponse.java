package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ConversationLastMessageResponse(
		String content,
		@JsonProperty("sender_id") UUID senderId,
		@JsonProperty("client_timestamp") Instant clientTimestamp,
		String status) {
}
