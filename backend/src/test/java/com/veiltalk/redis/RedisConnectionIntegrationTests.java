package com.veiltalk.redis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;

@SpringBootTest
class RedisConnectionIntegrationTests {

	private static final Duration TEST_TTL = Duration.ofSeconds(30);

	@Autowired
	private StringRedisTemplate redisTemplate;

	@Test
	void writesAndReadsBlacklistKeyWithTtl() {
		String key = "jwt:blacklist:p1-t06-" + UUID.randomUUID();

		try {
			redisTemplate.opsForValue().set(key, "1", TEST_TTL);

			assertEquals("1", redisTemplate.opsForValue().get(key));

			Long ttlSeconds = redisTemplate.getExpire(key, TimeUnit.SECONDS);
			assertNotNull(ttlSeconds);
			assertTrue(ttlSeconds > 0 && ttlSeconds <= TEST_TTL.toSeconds());
		}
		finally {
			redisTemplate.delete(key);
		}
	}
}
