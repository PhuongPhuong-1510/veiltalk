package com.veiltalk.messaging;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MessageListResponse(
		List<MessageHistoryResponse> data,
		@JsonProperty("prev_cursor") String previousCursor,
		@JsonProperty("has_more") boolean hasMore) {
}
