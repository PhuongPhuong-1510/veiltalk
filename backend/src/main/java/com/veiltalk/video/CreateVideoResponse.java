package com.veiltalk.video;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CreateVideoResponse(
		UUID id,
		String title,
		String status,
		@JsonProperty("upload_id") String uploadId,
		@JsonProperty("first_chunk_url") String firstChunkUrl,
		@JsonProperty("part_number") int partNumber,
		@JsonProperty("created_at") Instant createdAt) {
}
