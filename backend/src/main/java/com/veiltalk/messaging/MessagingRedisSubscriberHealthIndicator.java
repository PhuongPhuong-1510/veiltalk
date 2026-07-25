package com.veiltalk.messaging;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.stereotype.Component;

@Component
public class MessagingRedisSubscriberHealthIndicator implements HealthIndicator {

	private static final Status DEGRADED = new Status("DEGRADED");

	private final AtomicReference<Failure> lastFailure = new AtomicReference<>();

	@Override
	public Health health() {
		Failure failure = lastFailure.get();
		if (failure == null) {
			return Health.up().build();
		}
		return Health.status(DEGRADED)
				.withDetail("reason", failure.reason())
				.withDetail("failed_at", failure.failedAt())
				.build();
	}

	void markHealthy() {
		lastFailure.set(null);
	}

	void markDegraded(String reason) {
		lastFailure.set(new Failure(reason, Instant.now()));
	}

	private record Failure(String reason, Instant failedAt) {
	}
}
