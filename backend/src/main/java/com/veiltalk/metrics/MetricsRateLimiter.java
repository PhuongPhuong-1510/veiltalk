package com.veiltalk.metrics;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class MetricsRateLimiter {

	private static final String KEY_PREFIX = "rate:metrics-client:";
	private static final long MAX_REQUESTS = 1;
	private static final Duration WINDOW = Duration.ofSeconds(3);

	private final StringRedisTemplate redisTemplate;

	public MetricsRateLimiter(StringRedisTemplate redisTemplate) {
		this.redisTemplate = redisTemplate;
	}

	public Duration consume(UUID userId) {
		Instant now = Instant.now();
		long window = now.getEpochSecond() / WINDOW.getSeconds();
		String key = KEY_PREFIX + userId + ":" + window;
		Long count = redisTemplate.opsForValue().increment(key);
		if (count != null && count == 1L) {
			redisTemplate.expire(key, WINDOW);
		}
		if (count != null && count > MAX_REQUESTS) {
			long retryAfterSeconds = WINDOW.getSeconds() - (now.getEpochSecond() % WINDOW.getSeconds());
			return Duration.ofSeconds(retryAfterSeconds);
		}
		return Duration.ZERO;
	}
}
