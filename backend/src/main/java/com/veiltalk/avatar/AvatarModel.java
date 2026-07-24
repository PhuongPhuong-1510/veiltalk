package com.veiltalk.avatar;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AvatarModel(
		String id,
		String name,
		@JsonProperty("model_url") String modelUrl,
		@JsonProperty("thumbnail_url") String thumbnailUrl,
		@JsonProperty("supported_customizations") List<String> supportedCustomizations,
		@JsonProperty("outfit_options") List<String> outfitOptions) {
}
