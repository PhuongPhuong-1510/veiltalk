package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * P2-T24 — video_cleanup_jobs retry: backoff nhân đôi, giới hạn max attempts, và idempotency
 * (một retry "thành công" ở tầng job nghĩa là MinioMultipartStorage không ném lỗi — bao gồm cả
 * trường hợp NoSuchUpload đã được swallow ở {@link MinioMultipartStorage}, xem
 * {@code MinioMultipartStorageAbortTests}).
 */
class VideoCleanupRetryJobTests {

	private static final Instant NOW = Instant.parse("2026-07-26T10:00:00Z");

	@Test
	void successfulAbortRetryDeletesJobAndSoftDeletesVideo() {
		VideoCleanupJobRepository jobRepository = mock(VideoCleanupJobRepository.class);
		VideoRepository videoRepository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoProperties properties = properties();

		VideoCleanupJob job = VideoCleanupJob.abortMultipart(
				UUID.randomUUID(), "videos/x/source.mp4", "upload-1", NOW);
		given(jobRepository.findDue(NOW)).willReturn(List.of(job));

		VideoCleanupRetryJob retryJob = new VideoCleanupRetryJob(
				jobRepository, videoRepository, storage, properties, fixedClock());
		retryJob.runRetry();

		verify(storage).abortMultipartUpload(job.getStoragePath(), job.getUploadId());
		verify(videoRepository).failAndSoftDeleteRecording(job.getVideoId(), NOW);
		verify(jobRepository).delete(job);
		verify(jobRepository, never()).save(any());
	}

	@Test
	void successfulRemoveObjectRetryDeletesJobWithoutTouchingVideoStatus() {
		VideoCleanupJobRepository jobRepository = mock(VideoCleanupJobRepository.class);
		VideoRepository videoRepository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoProperties properties = properties();

		VideoCleanupJob job = VideoCleanupJob.removeObject(
				UUID.randomUUID(), "videos/orphan/source.mp4", NOW);
		given(jobRepository.findDue(NOW)).willReturn(List.of(job));

		VideoCleanupRetryJob retryJob = new VideoCleanupRetryJob(
				jobRepository, videoRepository, storage, properties, fixedClock());
		retryJob.runRetry();

		verify(storage).removeObject(job.getStoragePath());
		verify(videoRepository, never()).failAndSoftDeleteRecording(any(), any());
		verify(jobRepository).delete(job);
	}

	@Test
	void temporaryFailureDoublesBackoffAndIncrementsAttempts() {
		VideoCleanupJobRepository jobRepository = mock(VideoCleanupJobRepository.class);
		VideoRepository videoRepository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoProperties properties = properties();

		VideoCleanupJob job = VideoCleanupJob.abortMultipart(
				UUID.randomUUID(), "videos/x/source.mp4", "upload-1", NOW);
		job.setAttempts(2);
		given(jobRepository.findDue(NOW)).willReturn(List.of(job));
		willThrow(new VideoStorageException("MinIO unavailable", new RuntimeException()))
				.given(storage).abortMultipartUpload(job.getStoragePath(), job.getUploadId());

		VideoCleanupRetryJob retryJob = new VideoCleanupRetryJob(
				jobRepository, videoRepository, storage, properties, fixedClock());
		retryJob.runRetry();

		ArgumentCaptor<VideoCleanupJob> saved = ArgumentCaptor.forClass(VideoCleanupJob.class);
		verify(jobRepository).save(saved.capture());
		verify(jobRepository, never()).delete(any());
		assertThat(saved.getValue().getAttempts()).isEqualTo(3);
		// backoff nhân đôi từ 60s: attempt thứ 3 (index 2) => 60 * 2^2 = 240s.
		assertThat(saved.getValue().getNextAttemptAt()).isEqualTo(NOW.plusSeconds(240));
		assertThat(saved.getValue().getStatus()).isEqualTo(VideoCleanupJobStatus.PENDING);
	}

	@Test
	void reachingMaxAttemptsMarksFailedPermanentAndStopsRetrying() {
		VideoCleanupJobRepository jobRepository = mock(VideoCleanupJobRepository.class);
		VideoRepository videoRepository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoProperties properties = properties();

		VideoCleanupJob job = VideoCleanupJob.abortMultipart(
				UUID.randomUUID(), "videos/x/source.mp4", "upload-1", NOW);
		job.setAttempts(properties.cleanupJobMaxAttempts() - 1);
		given(jobRepository.findDue(NOW)).willReturn(List.of(job));
		willThrow(new VideoStorageException("MinIO unavailable", new RuntimeException()))
				.given(storage).abortMultipartUpload(job.getStoragePath(), job.getUploadId());

		VideoCleanupRetryJob retryJob = new VideoCleanupRetryJob(
				jobRepository, videoRepository, storage, properties, fixedClock());
		retryJob.runRetry();

		ArgumentCaptor<VideoCleanupJob> saved = ArgumentCaptor.forClass(VideoCleanupJob.class);
		verify(jobRepository).save(saved.capture());
		assertThat(saved.getValue().getStatus()).isEqualTo(VideoCleanupJobStatus.FAILED_PERMANENT);
		assertThat(saved.getValue().getAttempts()).isEqualTo(properties.cleanupJobMaxAttempts());
	}

	private VideoProperties properties() {
		return new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300, 60, 10, 60);
	}

	private Clock fixedClock() {
		return Clock.fixed(NOW, ZoneOffset.UTC);
	}
}
