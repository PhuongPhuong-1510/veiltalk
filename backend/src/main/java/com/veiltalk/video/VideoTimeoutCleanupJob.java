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
			VideoProperties properties) {
		this(videoRepository, multipartStorage, sessionStore, properties, Clock.systemUTC());
	}

	VideoTimeoutCleanupJob(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoProperties properties,
			Clock clock) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.properties = properties;
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
		if (videoRepository.failProcessing(video.getId()) != 1) {
			return;
		}
		try {
			multipartStorage.removeObject(video.getStoragePath());
		} catch (RuntimeException exception) {
			LOGGER.error("ORPHAN_VIDEO_OBJECT timeout cleanup thất bại cho video {} objectKey={}; "
					+ "cần P2-T24 retry", video.getId(), video.getStoragePath(), exception);
		} finally {
			try {
				sessionStore.deleteSession(video.getId());
			} catch (RuntimeException exception) {
				LOGGER.error("Không thể dọn Redis session timeout cho video {}", video.getId(), exception);
			}
		}
	}

	@PreDestroy
	void stop() {
		executor.shutdownNow();
	}
}
