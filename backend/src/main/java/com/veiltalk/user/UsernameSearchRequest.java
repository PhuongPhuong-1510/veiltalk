package com.veiltalk.user;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UsernameSearchRequest(
		@NotBlank @Size(max = 31) String query,
		@Min(1) @Max(10) Integer limit) {

	public int effectiveLimit() {
		return limit == null ? 10 : limit;
	}
}
