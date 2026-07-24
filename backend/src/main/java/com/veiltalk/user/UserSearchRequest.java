package com.veiltalk.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record UserSearchRequest(
		@NotBlank
		@Email
		String email) {
}
