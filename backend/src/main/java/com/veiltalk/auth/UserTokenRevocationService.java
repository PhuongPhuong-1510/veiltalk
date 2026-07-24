package com.veiltalk.auth;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class UserTokenRevocationService {

	private static final String KEY_PREFIX = "jwt:user-revoked-after:";

	private final StringRedisTemplate redisTemplate;
	private final Duration accessTokenMaxLifetime;

	public UserTokenRevocationService(
			StringRedisTemplate redisTemplate,
			@Value("${jwt.access-expiry}") long accessTokenExpirySeconds) {
		if (accessTokenExpirySeconds <= 0) {
			throw new IllegalArgumentException("Access token expiry must be positive");
		}
		this.redisTemplate = redisTemplate;
		this.accessTokenMaxLifetime = Duration.ofSeconds(accessTokenExpirySeconds);
	}

	public void revokeAllIssuedTokens(UUID userId, Instant revokedAt) {
		if (userId == null || revokedAt == null) {
			throw new IllegalArgumentException("User ID and revocation time are required");
		}
		Instant marker = revokedAt.truncatedTo(ChronoUnit.SECONDS);
		redisTemplate.opsForValue().set(
				key(userId),
				Long.toString(marker.getEpochSecond()),
				accessTokenMaxLifetime);
	}

	public boolean isRevoked(UUID userId, Instant issuedAt) {
		if (userId == null || issuedAt == null) {
			return true;
		}
		String storedMarker = redisTemplate.opsForValue().get(key(userId));
		if (storedMarker == null) {
			return false;
		}
		try {
			Instant revokedAfter = Instant.ofEpochSecond(Long.parseLong(storedMarker));
			return !issuedAt.isAfter(revokedAfter);
		}
		catch (NumberFormatException exception) {
			return true;
		}
	}

	String key(UUID userId) {
		if (userId == null) {
			throw new IllegalArgumentException("User ID is required");
		}
		return KEY_PREFIX + userId;
	}
}
