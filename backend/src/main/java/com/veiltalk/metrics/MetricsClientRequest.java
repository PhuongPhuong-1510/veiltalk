package com.veiltalk.metrics;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record MetricsClientRequest(
		@NotBlank
		@Pattern(regexp = "call|preview")
		@JsonProperty("session_type")
		String sessionType,

		@JsonProperty("tracking_latency_ms")
		Integer trackingLatencyMs,

		Double fps,

		@JsonProperty("webrtc_rtt_ms")
		Integer webrtcRttMs,

		@NotBlank
		String timestamp) {
}
