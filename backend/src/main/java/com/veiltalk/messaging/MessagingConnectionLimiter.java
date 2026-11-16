package com.veiltalk.messaging;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public class MessagingConnectionLimiter {
	private static final String ADMIT_SCRIPT = """
			local t = redis.call('TIME')
			local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
			local window = tonumber(ARGV[1])
			local lease = tonumber(ARGV[2])
			redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
			redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
			if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 1 end
			redis.call('ZADD', KEYS[1], now, ARGV[5])
			redis.call('PEXPIRE', KEYS[1], window)
			if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 2 end
			redis.call('ZADD', KEYS[2], now + lease, ARGV[5])
			redis.call('PEXPIRE', KEYS[2], lease)
			return 0
			""";
	private static final String RENEW_SCRIPT = """
			if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
			local t = redis.call('TIME')
			local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
			redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
			redis.call('PEXPIRE', KEYS[1], ARGV[2])
			return 1
			""";
	private final StringRedisTemplate redis;
	private final DefaultRedisScript<Long> admitScript = new DefaultRedisScript<>(ADMIT_SCRIPT, Long.class);
	private final DefaultRedisScript<Long> renewScript = new DefaultRedisScript<>(RENEW_SCRIPT, Long.class);
	private final int ipLimit;
	private final int userLimit;
	private final long windowMillis;
	private final long leaseMillis;

	public MessagingConnectionLimiter(StringRedisTemplate redis,
			@Value("${messaging.websocket.connection-ip-limit:20}") int ipLimit,
			@Value("${messaging.websocket.connection-user-limit:5}") int userLimit,
			@Value("${messaging.websocket.connection-window-seconds:60}") long windowSeconds,
			@Value("${messaging.websocket.connection-lease-seconds:120}") long leaseSeconds) {
		if (ipLimit <= 0 || userLimit <= 0 || windowSeconds <= 0 || leaseSeconds < 90
				|| windowSeconds > Long.MAX_VALUE / 1000 || leaseSeconds > Long.MAX_VALUE / 1000) {
			throw new IllegalArgumentException("Messaging connection policy is invalid");
		}
		this.redis = redis;
		this.ipLimit = ipLimit;
		this.userLimit = userLimit;
		this.windowMillis = Duration.ofSeconds(windowSeconds).toMillis();
		this.leaseMillis = Duration.ofSeconds(leaseSeconds).toMillis();
	}

	public Result reserve(String ip, UUID userId, UUID leaseId) {
		Long result = redis.execute(admitScript, List.of(ipKey(ip), userKey(userId)),
				String.valueOf(windowMillis), String.valueOf(leaseMillis),
				String.valueOf(ipLimit), String.valueOf(userLimit), leaseId.toString());
		if (result == null) throw new IllegalStateException("Messaging connection admission unavailable");
		return switch (result.intValue()) {
			case 0 -> Result.ALLOWED;
			case 1 -> Result.IP_LIMIT;
			case 2 -> Result.USER_LIMIT;
			default -> throw new IllegalStateException("Invalid messaging admission result");
		};
	}

	public boolean renew(UUID userId, UUID leaseId) {
		Long result = redis.execute(renewScript, List.of(userKey(userId)),
				leaseId.toString(), String.valueOf(leaseMillis));
		return result != null && result == 1;
	}

	public void release(UUID userId, UUID leaseId) {
		redis.opsForZSet().remove(userKey(userId), leaseId.toString());
	}

	private static String userKey(UUID userId) { return "rate:messaging:user:" + userId; }
	private static String ipKey(String ip) {
		try {
			return "rate:messaging:ip:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
					.digest(ip.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException("SHA-256 unavailable", exception);
		}
	}

	public enum Result { ALLOWED, IP_LIMIT, USER_LIMIT }
}
