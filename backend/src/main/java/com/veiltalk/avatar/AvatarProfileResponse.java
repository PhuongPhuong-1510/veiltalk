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
		@JsonProperty("profile_revision") UUID profileRevision,
		@JsonProperty("portrait_version") UUID portraitVersion,
		@JsonProperty("last_save_request_id") UUID lastSaveRequestId,
		@JsonProperty("created_at") Instant createdAt,
		@JsonProperty("updated_at") Instant updatedAt) {
}
