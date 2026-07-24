package com.veiltalk.auth;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;

public record RefreshTokenRequest(
		@JsonProperty("refresh_token")
		@NotBlank
		String refreshToken) {
}
