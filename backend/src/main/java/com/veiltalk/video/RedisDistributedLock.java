package com.veiltalk.video;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

@Component
public class RedisDistributedLock {

	private static final Logger LOGGER = LoggerFactory.getLogger(RedisDistributedLock.class);
	private static final RedisScript<Long> RELEASE_SCRIPT = new DefaultRedisScript<>(
			"if redis.call('GET', KEYS[1]) == ARGV[1] then "
					+ "return redis.call('DEL', KEYS[1]) else return 0 end",
			Long.class);
	private static final RedisScript<Long> RENEW_SCRIPT = new DefaultRedisScript<>(
			"if redis.call('GET', KEYS[1]) == ARGV[1] then "
					+ "return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end",
			Long.class);

	private final StringRedisTemplate redisTemplate;
	private final VideoProperties properties;
	private final ScheduledExecutorService renewer = Executors.newSingleThreadScheduledExecutor(runnable -> {
		Thread thread = new Thread(runnable, "video-lock-renewer");
		thread.setDaemon(true);
		return thread;
	});

	RedisDistributedLock(StringRedisTemplate redisTemplate, VideoProperties properties) {
		this.redisTemplate = redisTemplate;
		this.properties = properties;
	}

	public LockHandle acquire(String key) {
		String token = UUID.randomUUID().toString();
		long deadline = System.nanoTime()
				+ TimeUnit.MILLISECONDS.toNanos(properties.lockAcquireTimeoutMillis());
		do {
			Boolean acquired = redisTemplate.opsForValue().setIfAbsent(
					key, token, Duration.ofMillis(properties.lockTtlMillis()));
			if (Boolean.TRUE.equals(acquired)) {
				long period = Math.max(100L, properties.lockTtlMillis() / 3);
				LockHandle handle = new LockHandle(key, token);
				handle.renewal = renewer.scheduleAtFixedRate(
						() -> renew(key, token), period, period, TimeUnit.MILLISECONDS);
				return handle;
			}
			try {
				Thread.sleep(25);
			} catch (InterruptedException exception) {
				Thread.currentThread().interrupt();
				throw new VideoStorageException("Bị gián đoạn khi chờ distributed lock", exception);
			}
		} while (System.nanoTime() < deadline);
		throw new VideoOperationConflictException("Một thao tác khác đang xử lý video này.");
	}

	private void renew(String key, String token) {
		try {
			redisTemplate.execute(RENEW_SCRIPT, List.of(key), token,
					Long.toString(properties.lockTtlMillis()));
		} catch (RuntimeException exception) {
			// Không ném khỏi scheduled task để lần renewal kế tiếp vẫn còn cơ hội chạy.
			LOGGER.warn("Không thể renew video distributed lock {}", key, exception);
		}
	}

	@PreDestroy
	void shutdown() {
		renewer.shutdownNow();
	}

	public final class LockHandle implements AutoCloseable {
		private final String key;
		private final String token;
		private ScheduledFuture<?> renewal;
		private boolean closed;

		private LockHandle(String key, String token) {
			this.key = key;
			this.token = token;
		}

		@Override
		public void close() {
			if (closed) {
				return;
			}
			closed = true;
			renewal.cancel(false);
			redisTemplate.execute(RELEASE_SCRIPT, List.of(key), token);
		}
	}
}
