package com.veiltalk.auth;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LoginResponse(UserResponse user, TokenResponse tokens) {

	public record UserResponse(
			UUID id,
			String email,
			@JsonProperty("display_name") String displayName,
			String role,
			@JsonProperty("has_avatar") boolean hasAvatar) {
	}

	public record TokenResponse(
			@JsonProperty("access_token") String accessToken,
			@JsonProperty("refresh_token") String refreshToken,
			@JsonProperty("expires_in") long expiresIn) {
	}
}
