package com.veiltalk.video;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

public record VideoLibraryResponse(
		List<VideoSummary> data,
		@JsonProperty("storage_used_bytes") long storageUsedBytes,
		@JsonProperty("storage_limit_bytes") long storageLimitBytes,
		@JsonProperty("next_cursor") String nextCursor,
		@JsonProperty("has_more") boolean hasMore) {
}
