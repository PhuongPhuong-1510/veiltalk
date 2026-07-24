package com.veiltalk.auth;

import java.time.Duration;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class JwtBlacklistService {

	private static final String KEY_PREFIX = "jwt:blacklist:";

	private final StringRedisTemplate redisTemplate;

	public JwtBlacklistService(StringRedisTemplate redisTemplate) {
		this.redisTemplate = redisTemplate;
	}

	public boolean isBlacklisted(UUID jwtId) {
		return Boolean.TRUE.equals(redisTemplate.hasKey(key(jwtId)));
	}

	public void blacklist(UUID jwtId, Duration ttl) {
		if (jwtId == null || ttl == null || ttl.isZero() || ttl.isNegative()) {
			throw new IllegalArgumentException("JWT ID and a positive TTL are required");
		}
		redisTemplate.opsForValue().set(key(jwtId), "revoked", ttl);
	}

	String key(UUID jwtId) {
		if (jwtId == null) {
			throw new IllegalArgumentException("JWT ID is required");
		}
		return KEY_PREFIX + jwtId;
	}
}
