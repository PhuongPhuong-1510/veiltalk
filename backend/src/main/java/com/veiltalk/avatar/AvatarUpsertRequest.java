package com.veiltalk.avatar;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Null;

public record AvatarUpsertRequest(
		@NotBlank @JsonProperty("model_id") String modelId,
		Map<String, Object> customizations,
		@Null(message = "model_url must not be provided")
		@JsonProperty("model_url") String modelUrl) {
}
