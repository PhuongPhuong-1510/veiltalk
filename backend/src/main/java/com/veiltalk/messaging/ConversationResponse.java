package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ConversationResponse(
		UUID id,
		@JsonProperty("other_user") OtherUserResponse otherUser,
		@JsonProperty("created_at") Instant createdAt,
		@JsonProperty("updated_at") Instant updatedAt) {

	public record OtherUserResponse(
			UUID id,
			@JsonProperty("display_name") String displayName,
			@JsonProperty("avatar_url") String avatarUrl) {
	}
}
