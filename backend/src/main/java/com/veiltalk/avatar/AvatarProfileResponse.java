package com.veiltalk.avatar;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AvatarProfileResponse(
		UUID id,
		@JsonProperty("user_id") UUID userId,
		@JsonProperty("model_id") String modelId,
		@JsonProperty("model_url") String modelUrl,
		Map<String, Object> customizations,
		@JsonProperty("created_at") Instant createdAt,
		@JsonProperty("updated_at") Instant updatedAt) {
}
