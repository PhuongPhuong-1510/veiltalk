package com.veiltalk.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AuthAbuseRateLimiter {
	private static final String WINDOW_SCRIPT = """
			local nowParts = redis.call('TIME')
			local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
			local window = tonumber(ARGV[1])
			redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
			if ARGV[2] == 'add' then
			  redis.call('ZADD', KEYS[1], now, ARGV[3])
			  redis.call('PEXPIRE', KEYS[1], window)
			end
			local count = redis.call('ZCARD', KEYS[1])
			local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
			local retry = 0
			if count > 0 then retry = math.max(1, tonumber(oldest[2]) + window - now) end
			return {count, retry}
			""";
	private static final String RESERVE_SCRIPT = """
			local count = tonumber(redis.call('GET', KEYS[1]) or '0')
			if count >= tonumber(ARGV[1]) then return math.max(1, redis.call('PTTL', KEYS[1])) end
			count = redis.call('INCR', KEYS[1])
			if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
			return 0
			""";
	private static final String RELEASE_SCRIPT = """
			local count = tonumber(redis.call('GET', KEYS[1]) or '0')
			if count > 0 then redis.call('DECR', KEYS[1]) end
			return 0
			""";

	private final StringRedisTemplate redis;
	private final DefaultRedisScript<List> windowScript = new DefaultRedisScript<>(WINDOW_SCRIPT, List.class);
	private final DefaultRedisScript<Long> reserveScript = new DefaultRedisScript<>(RESERVE_SCRIPT, Long.class);
	private final DefaultRedisScript<Long> releaseScript = new DefaultRedisScript<>(RELEASE_SCRIPT, Long.class);
	private final int loginPairLimit;
	private final int loginIpLimit;
	private final Duration loginWindow;
	private final int registerSuccessLimit;
	private final int registerFailureLimit;
	private final Duration registerWindow;

	public AuthAbuseRateLimiter(StringRedisTemplate redis,
			@Value("${auth.abuse.login-pair-limit:5}") int loginPairLimit,
			@Value("${auth.abuse.login-ip-limit:30}") int loginIpLimit,
			@Value("${auth.abuse.login-window-seconds:900}") long loginWindowSeconds,
			@Value("${auth.abuse.register-success-limit:5}") int registerSuccessLimit,
			@Value("${auth.abuse.register-failure-limit:30}") int registerFailureLimit,
			@Value("${auth.abuse.register-window-seconds:3600}") long registerWindowSeconds) {
		if (loginPairLimit <= 0 || loginIpLimit <= 0 || loginWindowSeconds <= 0
				|| registerSuccessLimit <= 0 || registerFailureLimit <= 0 || registerWindowSeconds <= 0) {
			throw new IllegalArgumentException("Auth abuse limits and windows must be positive");
		}
		this.redis = redis;
		this.loginPairLimit = loginPairLimit;
		this.loginIpLimit = loginIpLimit;
		this.loginWindow = Duration.ofSeconds(loginWindowSeconds);
		this.registerSuccessLimit = registerSuccessLimit;
		this.registerFailureLimit = registerFailureLimit;
		this.registerWindow = Duration.ofSeconds(registerWindowSeconds);
	}

	public void checkLogin(String email, String ip) {
		checkWindow(pairKey(email, ip), loginWindow, loginPairLimit);
		checkWindow(loginIpKey(ip), loginWindow, loginIpLimit);
	}

	public void recordLoginPairFailure(String email, String ip) {
		addFailure(pairKey(email, ip), loginWindow, loginPairLimit);
	}

	public void recordLoginIpFailure(String ip) {
		addFailure(loginIpKey(ip), loginWindow, loginIpLimit);
	}

	public void checkLoginIp(String ip) {
		checkWindow(loginIpKey(ip), loginWindow, loginIpLimit);
	}

	public void checkRegistrationFailures(String ip) {
		checkWindow(registerFailureKey(ip), registerWindow, registerFailureLimit);
	}

	public void recordRegistrationFailure(String ip) {
		addFailure(registerFailureKey(ip), registerWindow, registerFailureLimit);
	}

	public void reserveRegistration(String ip) {
		Long retry = redis.execute(reserveScript, List.of(registerSuccessKey(ip)),
				String.valueOf(registerSuccessLimit), String.valueOf(registerWindow.toMillis()));
		if (retry == null) throw new IllegalStateException("Redis did not check registration limit");
		if (retry > 0) throw new TooManyRequestsException(Duration.ofMillis(retry));
	}

	public void releaseRegistration(String ip) {
		redis.execute(releaseScript, List.of(registerSuccessKey(ip)));
	}

	private void checkWindow(String key, Duration window, int limit) {
		WindowResult result = window(key, window, false);
		if (result.count >= limit) throw new TooManyRequestsException(result.retryAfter);
	}

	private void addFailure(String key, Duration window, int limit) {
		WindowResult result = window(key, window, true);
		if (result.count > limit) throw new TooManyRequestsException(result.retryAfter);
	}

	private WindowResult window(String key, Duration window, boolean add) {
		List result = redis.execute(windowScript, List.of(key), String.valueOf(window.toMillis()),
				add ? "add" : "check", UUID.randomUUID().toString());
		if (result == null || result.size() != 2) throw new IllegalStateException("Redis did not check auth limit");
		return new WindowResult(((Number) result.get(0)).longValue(),
				Duration.ofMillis(((Number) result.get(1)).longValue()));
	}

	private String pairKey(String email, String ip) {
		return "rate:auth:login-pair:" + hash(email.trim().toLowerCase(Locale.ROOT) + '\0' + ip);
	}
	private String loginIpKey(String ip) { return "rate:auth:login-ip:" + hash(ip); }
	private String registerSuccessKey(String ip) { return "rate:auth:register-success:" + hash(ip); }
	private String registerFailureKey(String ip) { return "rate:auth:register-failure:" + hash(ip); }

	private String hash(String value) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
					.digest(value.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException("SHA-256 unavailable", exception);
		}
	}

	private record WindowResult(long count, Duration retryAfter) { }
}
