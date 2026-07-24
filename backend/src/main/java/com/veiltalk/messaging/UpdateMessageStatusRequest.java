package com.veiltalk.messaging;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record UpdateMessageStatusRequest(
		@NotNull
		@Pattern(regexp = "^(delivered|read)$")
		String status) {
}
