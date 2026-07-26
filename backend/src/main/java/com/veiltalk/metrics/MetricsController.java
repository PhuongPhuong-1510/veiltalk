package com.veiltalk.metrics;

import java.time.Duration;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class MetricsController {

	private final MetricsService metricsService;

	public MetricsController(MetricsService metricsService) {
		this.metricsService = metricsService;
	}

	@PostMapping("/metrics/client")
	ResponseEntity<Void> recordClientMetrics(
			Authentication authentication,
			@Valid @RequestBody MetricsClientRequest request) {
		Duration retryAfter = metricsService.record((UUID) authentication.getPrincipal(), request);
		if (!retryAfter.isZero()) {
			return ResponseEntity.status(429)
					.header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfter.toSeconds()))
					.build();
		}
		return ResponseEntity.noContent().build();
	}
}
