package com.veiltalk.video;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record VideoSummary(
		UUID id,
		String title,
		String status,
		@JsonProperty("duration_secs") Integer durationSecs,
		@JsonProperty("file_size_bytes") long fileSizeBytes,
		String format,
		@JsonProperty("created_at") Instant createdAt) {
}
