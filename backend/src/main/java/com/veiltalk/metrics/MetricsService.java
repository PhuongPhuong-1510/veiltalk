package com.veiltalk.metrics;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.veiltalk.auth.ValidationException;

@Service
public class MetricsService {

	private static final Logger LOGGER = LoggerFactory.getLogger(MetricsService.class);

	private final MetricsRateLimiter rateLimiter;

	public MetricsService(MetricsRateLimiter rateLimiter) {
		this.rateLimiter = rateLimiter;
	}

	public Duration record(UUID userId, MetricsClientRequest request) {
		Instant clientTimestamp = parseTimestamp(request.timestamp());

		Duration retryAfter = rateLimiter.consume(userId);
		if (!retryAfter.isZero()) {
			return retryAfter;
		}

		LOGGER.info(
				"CLIENT_METRICS user_id={} session_type={} tracking_latency_ms={} fps={} webrtc_rtt_ms={} client_timestamp={}",
				userId,
				request.sessionType(),
				request.trackingLatencyMs(),
				request.fps(),
				request.webrtcRttMs(),
				clientTimestamp);
		return Duration.ZERO;
	}

	private Instant parseTimestamp(String timestamp) {
		try {
			return Instant.parse(timestamp);
		} catch (DateTimeException exception) {
			throw new ValidationException("timestamp phải theo định dạng ISO 8601");
		}
	}
}
