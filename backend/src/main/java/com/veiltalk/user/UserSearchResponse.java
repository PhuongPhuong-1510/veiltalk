package com.veiltalk.user;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UserSearchResponse(
		boolean found,
		UserSummary user) {

	public record UserSummary(
			UUID id,
			@JsonProperty("display_name") String displayName) {
	}
}
