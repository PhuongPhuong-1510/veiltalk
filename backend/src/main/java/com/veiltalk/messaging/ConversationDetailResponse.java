package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ConversationDetailResponse(
		UUID id,
		@JsonProperty("other_user") ConversationResponse.OtherUserResponse otherUser,
		@JsonProperty("last_message") ConversationLastMessageResponse lastMessage,
		@JsonProperty("created_at") Instant createdAt,
		@JsonProperty("updated_at") Instant updatedAt) {
}
