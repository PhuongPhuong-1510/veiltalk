package com.veiltalk.auth;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record RegisterResponse(UserResponse user, TokenResponse tokens) {

	public record UserResponse(
			UUID id,
			String email,
			@JsonProperty("display_name") String displayName,
			String role,
			@JsonProperty("created_at") Instant createdAt) {
	}

	public record TokenResponse(
			@JsonProperty("access_token") String accessToken,
			@JsonProperty("refresh_token") String refreshToken,
			@JsonProperty("expires_in") long expiresIn) {
	}
}
