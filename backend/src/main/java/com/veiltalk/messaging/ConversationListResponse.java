package com.veiltalk.messaging;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ConversationListResponse(
		List<ConversationSummaryResponse> data,
		@JsonProperty("next_cursor") String nextCursor,
		@JsonProperty("has_more") boolean hasMore) {
}
