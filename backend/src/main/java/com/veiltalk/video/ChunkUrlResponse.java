package com.veiltalk.video;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ChunkUrlResponse(
		@JsonProperty("chunk_url") String chunkUrl,
		@JsonProperty("part_number") int partNumber,
		// Cùng nguồn với TTL lúc ký URL (video.presigned-url-expiry-seconds).
		@JsonProperty("expires_in") long expiresIn) {
}
