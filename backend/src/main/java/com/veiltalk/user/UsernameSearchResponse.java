package com.veiltalk.user;

import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UsernameSearchResponse(
		List<UserSummary> data,
		Meta meta) {

	public record UserSummary(
			UUID id,
			String username,
			@JsonProperty("display_name") String displayName,
			@JsonProperty("avatar_url") String avatarUrl) {
	}

	public record Meta(int limit, boolean truncated) {
	}
}
