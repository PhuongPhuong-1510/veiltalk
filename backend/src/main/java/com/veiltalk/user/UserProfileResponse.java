package com.veiltalk.user;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UserProfileResponse(
		UUID id,
		String email,
		@JsonProperty("display_name") String displayName,
		@JsonProperty("avatar_url") String avatarUrl,
		String role,
		@JsonProperty("has_avatar") boolean hasAvatar,
		@JsonProperty("created_at") Instant createdAt) {
}
