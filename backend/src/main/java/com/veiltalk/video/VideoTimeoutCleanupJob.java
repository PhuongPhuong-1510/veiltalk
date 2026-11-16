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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

@Component
public class VideoTimeoutCleanupJob {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoTimeoutCleanupJob.class);

	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoUploadSessionStore sessionStore;
	private final VideoCleanupJobRepository cleanupJobRepository;
	private final VideoProperties properties;
	private final VideoMediaValidator mediaValidator;
	private final RedisDistributedLock distributedLock;
	private final Clock clock;
	@Value("${video.recording-cleanup-interval-seconds:3600}")
	private long recordingCleanupIntervalSeconds = 3600;
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
			VideoCleanupJobRepository cleanupJobRepository,
			VideoProperties properties,
			RedisDistributedLock distributedLock,
			VideoMediaValidator mediaValidator) {
		this(videoRepository, multipartStorage, sessionStore, cleanupJobRepository, properties,
				distributedLock, mediaValidator, Clock.systemUTC());
	}

	VideoTimeoutCleanupJob(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoCleanupJobRepository cleanupJobRepository,
			VideoProperties properties,
			RedisDistributedLock distributedLock,
			VideoMediaValidator mediaValidator,
			Clock clock) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.cleanupJobRepository = cleanupJobRepository;
		this.properties = properties;
		this.mediaValidator = mediaValidator;
		this.distributedLock = distributedLock;
		this.clock = clock;
	}

	@PostConstruct
	void start() {
		long interval = properties.cleanupIntervalSeconds();
		executor.scheduleWithFixedDelay(this::runSafely, interval, interval, TimeUnit.SECONDS);
		if (recordingCleanupIntervalSeconds <= 0 || properties.uploadSessionTtlSeconds() <= 0) {
			throw new IllegalArgumentException("Recording cleanup policy must be positive");
		}
		executor.scheduleWithFixedDelay(this::runRecordingSafely,
				recordingCleanupIntervalSeconds, recordingCleanupIntervalSeconds, TimeUnit.SECONDS);
	}

	void runRecordingCleanup() {
		Instant cutoff = clock.instant().minusSeconds(properties.uploadSessionTtlSeconds());
		for (Video video : videoRepository.findOldRecordingCandidates(cutoff)) {
			try {
				cleanupRecording(video.getId());
			} catch (RuntimeException exception) {
				LOGGER.error("Could not clean expired recording {}", video.getId(), exception);
			}
		}
	}

	private void runRecordingSafely() {
		try { runRecordingCleanup(); }
		catch (RuntimeException exception) { LOGGER.error("Recording cleanup scan failed", exception); }
	}

	private void cleanupRecording(java.util.UUID videoId) {
		try (var videoLock = distributedLock.acquire("video:operation-lock:" + videoId)) {
			Video current = videoRepository.findById(videoId).orElse(null);
			if (current == null || current.getDeletedAt() != null
					|| current.getStatus() != VideoStatus.RECORDING
					|| !current.getCreatedAt().isBefore(clock.instant().minusSeconds(properties.uploadSessionTtlSeconds()))
					|| sessionStore.findSession(videoId).isPresent()) return;
			String uploadId = current.getUploadId();
			if (uploadId != null && !uploadId.isBlank()) {
				try {
					multipartStorage.abortMultipartUpload(current.getStoragePath(), uploadId);
				} catch (RuntimeException exception) {
					cleanupJobRepository.save(VideoCleanupJob.abortMultipart(
							videoId, current.getStoragePath(), uploadId, clock.instant()));
					LOGGER.error("Recording multipart abort failed for video {}; retry queued", videoId);
				}
			}
			if (videoRepository.failAndSoftDeleteRecording(videoId, clock.instant()) == 1) {
				deleteSession(videoId);
			}
		}
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
			if (objectSize.isPresent() && objectSize.getAsLong() == video.getFileSizeBytes()
					&& mediaValidator.isPlayable(video.getStoragePath(), video.getFormat(), video.getFileSizeBytes())) {
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
							+ "ghi cleanup job để retry", video.getId(), video.getStoragePath(), exception);
					cleanupJobRepository.save(VideoCleanupJob.removeObject(
							video.getId(), video.getStoragePath(), clock.instant()));
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
