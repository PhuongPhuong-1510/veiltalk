package com.veiltalk.avatar;

import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AvatarPublicResponse(
		@JsonProperty("user_id") UUID userId,
		@JsonProperty("model_id") String modelId,
		@JsonProperty("model_url") String modelUrl,
		Map<String, Object> customizations) {
}
