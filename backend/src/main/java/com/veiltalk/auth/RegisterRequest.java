package com.veiltalk.auth;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
		@NotBlank
		@Email
		String email,

		@NotBlank
		@Pattern(
				regexp = "^(?=.*[A-Z])(?=.*\\d).{8,}$",
				message = "password must contain at least 8 characters, one uppercase letter, and one number")
		String password,

		@JsonProperty("display_name")
		@NotBlank
		@Size(max = 100)
		String displayName) {
}
