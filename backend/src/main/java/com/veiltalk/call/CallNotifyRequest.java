package com.veiltalk.call;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CallNotifyRequest(
		@JsonProperty("caller_id") UUID callerId,
		@JsonProperty("callee_id") UUID calleeId) {
}
