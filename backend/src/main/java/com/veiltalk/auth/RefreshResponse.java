package com.veiltalk.auth;

import com.fasterxml.jackson.annotation.JsonProperty;

public record RefreshResponse(
		@JsonProperty("access_token") String accessToken,
		@JsonProperty("expires_in") long expiresIn) {
}
