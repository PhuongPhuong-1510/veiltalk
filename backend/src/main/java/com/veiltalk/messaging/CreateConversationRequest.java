package com.veiltalk.messaging;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotNull;

public record CreateConversationRequest(
		@NotNull @JsonProperty("other_user_id") UUID otherUserId) {
}
