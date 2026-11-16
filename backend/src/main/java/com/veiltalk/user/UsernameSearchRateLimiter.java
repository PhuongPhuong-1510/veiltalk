package com.veiltalk.user;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

@Service
public class UsernameSearchRateLimiter {

	private static final int CAPACITY = 10;
	private static final int REFILL_TOKENS_PER_WINDOW = 30;
	private static final long REFILL_WINDOW_MILLIS = 60_000L;
	private static final String KEY_PREFIX = "rate:username-search:";
	private static final DefaultRedisScript<Long> SCRIPT = new DefaultRedisScript<>("""
			local nowParts = redis.call('TIME')
			local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
			local capacity = tonumber(ARGV[1])
			local refillTokens = tonumber(ARGV[2])
			local window = tonumber(ARGV[3])
			local refillPerMs = refillTokens / window
			local values = redis.call('HMGET', KEYS[1], 'tokens', 'last')
			local tokens = tonumber(values[1]) or capacity
			local last = tonumber(values[2]) or now
			tokens = math.min(capacity, tokens + math.max(0, now - last) * refillPerMs)
			if tokens < 1 then
			  redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', now)
			  redis.call('PEXPIRE', KEYS[1], window * 2)
			  return math.max(1, math.ceil((1 - tokens) / refillPerMs / 1000))
			end
			tokens = tokens - 1
			redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', now)
			redis.call('PEXPIRE', KEYS[1], window * 2)
			return 0
			""", Long.class);

	private final StringRedisTemplate redisTemplate;

	public UsernameSearchRateLimiter(StringRedisTemplate redisTemplate) {
		this.redisTemplate = redisTemplate;
	}

	public Duration consume(UUID userId) {
		Long retryAfter = redisTemplate.execute(
				SCRIPT,
				List.of(key(userId)),
				String.valueOf(CAPACITY),
				String.valueOf(REFILL_TOKENS_PER_WINDOW),
				String.valueOf(REFILL_WINDOW_MILLIS));
		return retryAfter == null || retryAfter <= 0 ? Duration.ZERO : Duration.ofSeconds(retryAfter);
	}

	String key(UUID userId) {
		return KEY_PREFIX + userId;
	}
}
