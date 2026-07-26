package com.veiltalk.video;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

@Component
public class VideoTimeoutCleanupJob {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoTimeoutCleanupJob.class);

	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoUploadSessionStore sessionStore;
	private final VideoProperties properties;
	private final RedisDistributedLock distributedLock;
	private final Clock clock;
	private final ScheduledExecutorService executor =
			Executors.newSingleThreadScheduledExecutor(runnable -> {
				Thread thread = new Thread(runnable, "video-timeout-cleanup");
				thread.setDaemon(true);
				return thread;
			});

	@Autowired
	VideoTimeoutCleanupJob(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoProperties properties,
			RedisDistributedLock distributedLock) {
		this(videoRepository, multipartStorage, sessionStore, properties, distributedLock,
				Clock.systemUTC());
	}

	VideoTimeoutCleanupJob(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoProperties properties,
			RedisDistributedLock distributedLock,
			Clock clock) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.properties = properties;
		this.distributedLock = distributedLock;
		this.clock = clock;
	}

	@PostConstruct
	void start() {
		long interval = properties.cleanupIntervalSeconds();
		executor.scheduleWithFixedDelay(this::runSafely, interval, interval, TimeUnit.SECONDS);
	}

	void runCleanup() {
		Instant cutoff = clock.instant().minusSeconds(properties.processingTimeoutSeconds());
		List<Video> timedOut = videoRepository.findTimedOutProcessing(cutoff);
		for (Video video : timedOut) {
			try {
				cleanupOne(video);
			} catch (RuntimeException exception) {
				LOGGER.error("Không thể cleanup video processing timeout {}", video.getId(), exception);
			}
		}
	}

	private void runSafely() {
		try {
			runCleanup();
		} catch (RuntimeException exception) {
			LOGGER.error("Lượt quét video processing timeout thất bại", exception);
		}
	}

	private void cleanupOne(Video video) {
		try (var videoLock = distributedLock.acquire(
				"video:operation-lock:" + video.getId())) {
			var objectSize = multipartStorage.statObjectSize(video.getStoragePath());
			if (objectSize.isPresent() && objectSize.getAsLong() == video.getFileSizeBytes()) {
				videoRepository.markReadyFromWebhook(
						video.getStoragePath(), video.getFileSizeBytes());
				deleteSession(video.getId());
				return;
			}

			if (videoRepository.failProcessing(video.getId()) != 1) {
				return;
			}
			// Chỉ xóa khi HEAD đã thấy một object sai kích thước. Nếu object không tồn tại,
			// không phát lệnh xóa có thể đua với CompleteMultipartUpload.
			if (objectSize.isPresent()) {
				try {
					multipartStorage.removeObject(video.getStoragePath());
				} catch (RuntimeException exception) {
					LOGGER.error("ORPHAN_VIDEO_OBJECT timeout cleanup thất bại cho video {} objectKey={}; "
							+ "cần P2-T24 retry", video.getId(), video.getStoragePath(), exception);
				}
			}
			deleteSession(video.getId());
		}
	}

	private void deleteSession(java.util.UUID videoId) {
		try {
			sessionStore.deleteSession(videoId);
		} catch (RuntimeException exception) {
			LOGGER.error("Không thể dọn Redis session timeout cho video {}", videoId, exception);
		}
	}

	@PreDestroy
	void stop() {
		executor.shutdownNow();
	}
}
