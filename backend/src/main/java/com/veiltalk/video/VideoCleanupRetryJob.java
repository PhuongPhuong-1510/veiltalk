package com.veiltalk.video;

import java.time.Clock;
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

/**
 * P2-T24 — retry bền vững cho {@code video_cleanup_jobs}. Dùng chung cho hai nguồn lỗi:
 * ABORT_MULTIPART (xóa tài khoản, {@link VideoAccountCleanupService}) và REMOVE_OBJECT
 * (orphan object timeout, {@link VideoTimeoutCleanupJob}).
 *
 * <p>Cả hai thao tác MinIO đều idempotent theo thiết kế: {@code abortMultipartUpload} coi
 * NoSuchUpload là thành công (đã abort/complete trước đó — xem {@link MinioMultipartStorage}),
 * removeObject của S3-compatible storage không lỗi khi object đã không còn. Vì vậy job chỉ
 * cần backoff khi MinIO thật sự lỗi tạm thời, không cần phân biệt "đã xong" ở tầng job.
 */
@Component
public class VideoCleanupRetryJob {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoCleanupRetryJob.class);

	private final VideoCleanupJobRepository cleanupJobRepository;
	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoProperties properties;
	private final Clock clock;
	private final ScheduledExecutorService executor =
			Executors.newSingleThreadScheduledExecutor(runnable -> {
				Thread thread = new Thread(runnable, "video-cleanup-retry");
				thread.setDaemon(true);
				return thread;
			});

	@Autowired
	VideoCleanupRetryJob(
			VideoCleanupJobRepository cleanupJobRepository,
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoProperties properties) {
		this(cleanupJobRepository, videoRepository, multipartStorage, properties, Clock.systemUTC());
	}

	VideoCleanupRetryJob(
			VideoCleanupJobRepository cleanupJobRepository,
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoProperties properties,
			Clock clock) {
		this.cleanupJobRepository = cleanupJobRepository;
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.properties = properties;
		this.clock = clock;
	}

	@PostConstruct
	void start() {
		long interval = properties.cleanupJobPollIntervalSeconds();
		executor.scheduleWithFixedDelay(this::runSafely, interval, interval, TimeUnit.SECONDS);
	}

	void runRetry() {
		List<VideoCleanupJob> due = cleanupJobRepository.findDue(clock.instant());
		for (VideoCleanupJob job : due) {
			try {
				retryOne(job);
			} catch (RuntimeException exception) {
				LOGGER.error("VIDEO_CLEANUP_RETRY_UNEXPECTED_FAILURE jobId={}", job.getId(), exception);
			}
		}
	}

	private void runSafely() {
		try {
			runRetry();
		} catch (RuntimeException exception) {
			LOGGER.error("Lượt quét video_cleanup_jobs thất bại", exception);
		}
	}

	private void retryOne(VideoCleanupJob job) {
		try {
			switch (job.getOperation()) {
				case ABORT_MULTIPART -> {
					multipartStorage.abortMultipartUpload(job.getStoragePath(), job.getUploadId());
					videoRepository.failAndSoftDeleteRecording(job.getVideoId(), clock.instant());
				}
				case REMOVE_OBJECT -> multipartStorage.removeObject(job.getStoragePath());
			}
			cleanupJobRepository.delete(job);
		} catch (RuntimeException exception) {
			handleRetryFailure(job, exception);
		}
	}

	private void handleRetryFailure(VideoCleanupJob job, RuntimeException exception) {
		int attempts = job.getAttempts() + 1;
		job.setAttempts(attempts);
		job.setLastError(truncate(exception.getMessage()));
		if (attempts >= properties.cleanupJobMaxAttempts()) {
			job.setStatus(VideoCleanupJobStatus.FAILED_PERMANENT);
			LOGGER.error("VIDEO_CLEANUP_JOB_FAILED_PERMANENT jobId={} videoId={} operation={} attempts={}",
					job.getId(), job.getVideoId(), job.getOperation(), attempts, exception);
		} else {
			long backoffSeconds = properties.cleanupJobInitialBackoffSeconds() << (attempts - 1);
			job.setNextAttemptAt(clock.instant().plusSeconds(backoffSeconds));
			LOGGER.warn("VIDEO_CLEANUP_JOB_RETRY_SCHEDULED jobId={} videoId={} attempts={} nextAttemptAt={}",
					job.getId(), job.getVideoId(), attempts, job.getNextAttemptAt(), exception);
		}
		cleanupJobRepository.save(job);
	}

	private String truncate(String message) {
		if (message == null) {
			return null;
		}
		return message.length() > 1000 ? message.substring(0, 1000) : message;
	}

	@PreDestroy
	void stop() {
		executor.shutdownNow();
	}
}
