package com.veiltalk.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.veiltalk.auth.ValidTextControls;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateMessageRequest(
		@NotNull UUID id,
		@NotBlank @Size(max = 4000) @ValidTextControls(allowMessageFormatting = true) String content,
		@NotNull @JsonProperty("client_timestamp") Instant clientTimestamp) {
}
