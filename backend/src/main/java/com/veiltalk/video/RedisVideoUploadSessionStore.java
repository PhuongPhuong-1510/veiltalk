package com.veiltalk.video;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

@Component
public class RedisVideoUploadSessionStore implements VideoUploadSessionStore {

	// part 1 đã có URL từ lúc initiate (P2-T20); endpoint /chunks luôn xin part ≥ 2.
	private static final int FIRST_CHUNK_ENDPOINT_PART = 2;

	// Kiểm tra thứ tự + idempotency + quota + cập nhật state trong MỘT lần chạy nguyên tử.
	// Redis single-thread + EVAL đảm bảo không có request thứ hai chen vào giữa read và write.
	// LƯU Ý: field hash và ARGV đều là string — tonumber() trước khi so sánh số.
	private static final RedisScript<String> RESERVE_SCRIPT = new DefaultRedisScript<>(
			"""
			if redis.call('EXISTS', KEYS[1]) == 0 then
			  return 'ERR_NO_SESSION'
			end
			if redis.call('HGET', KEYS[1], 'uploadId') ~= ARGV[1] then
			  return 'ERR_UPLOAD'
			end
			local k = tonumber(ARGV[2])
			local nextPart = tonumber(redis.call('HGET', KEYS[1], 'nextPartNumber'))
			local chunkSize = tonumber(redis.call('HGET', KEYS[1], 'chunkSizeBytes'))
			local readyBytes = tonumber(ARGV[4])
			local limit = tonumber(ARGV[5])
			local ttlMillis = tonumber(ARGV[6])
			-- Quota: ước lượng bảo thủ (giả định mọi part đầy chunkSize). Số thật chốt ở webhook (T23).
			if readyBytes + k * chunkSize > limit then
			  return 'ERR_QUOTA'
			end
			if k == nextPart then
			  redis.call('HSET', KEYS[1], 'etag:' .. (k - 1), ARGV[3])
			  redis.call('HSET', KEYS[1], 'nextPartNumber', k + 1)
			  redis.call('PEXPIRE', KEYS[1], ttlMillis)
			  return 'OK'
			elseif k < nextPart then
			  if redis.call('HGET', KEYS[1], 'etag:' .. (k - 1)) == ARGV[3] then
			    redis.call('PEXPIRE', KEYS[1], ttlMillis)
			    return 'RETRY'
			  end
			  return 'ERR_ETAG'
			else
			  return 'ERR_ORDER'
			end
			""",
			String.class);

	private final StringRedisTemplate redisTemplate;
	private final VideoProperties videoProperties;

	RedisVideoUploadSessionStore(StringRedisTemplate redisTemplate, VideoProperties videoProperties) {
		this.redisTemplate = redisTemplate;
		this.videoProperties = videoProperties;
	}

	static String sessionKey(UUID videoId) {
		return "video:upload:" + videoId;
	}

	@Override
	public void createSession(UUID videoId, String uploadId, UUID userId, long chunkSizeBytes) {
		String key = sessionKey(videoId);
		redisTemplate.opsForHash().putAll(key, Map.of(
				"uploadId", uploadId,
				"userId", userId.toString(),
				"chunkSizeBytes", Long.toString(chunkSizeBytes),
				"nextPartNumber", Integer.toString(FIRST_CHUNK_ENDPOINT_PART)));
		redisTemplate.expire(key, videoProperties.uploadSessionTtlSeconds(), TimeUnit.SECONDS);
	}

	@Override
	public ReserveResult reserveNextPart(
			UUID videoId,
			String uploadId,
			int partNumber,
			String etagPrevious,
			long readyBytes,
			long storageLimitBytes) {
		long ttlMillis = videoProperties.uploadSessionTtlSeconds() * 1000L;
		String result = redisTemplate.execute(
				RESERVE_SCRIPT,
				List.of(sessionKey(videoId)),
				uploadId,
				Integer.toString(partNumber),
				etagPrevious,
				Long.toString(readyBytes),
				Long.toString(storageLimitBytes),
				Long.toString(ttlMillis));
		return ReserveResult.valueOf(result);
	}
}
