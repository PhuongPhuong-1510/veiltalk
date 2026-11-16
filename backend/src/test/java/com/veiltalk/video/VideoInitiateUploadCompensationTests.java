package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willAnswer;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;

class VideoInitiateUploadCompensationTests {

	@Test
	void vid017RedisSessionFailureAbortsTheAlreadyCreatedMultipartUpload() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		EntityManager entityManager = mock(EntityManager.class);
		Query userLockQuery = mock(Query.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		VideoCleanupTransactionSupport cleanup = mock(VideoCleanupTransactionSupport.class);
		VideoProperties properties = new VideoProperties(
				Long.MAX_VALUE, 21_600, 3_600, 30_000, 5_000, 600, 300, 60, 10, 60);
		UUID userId = UUID.randomUUID();
		UUID videoId = UUID.randomUUID();
		String uploadId = "minio-upload-created-before-redis";
		String firstPartUrl = "http://minio.invalid/first-part";

		given(entityManager.createNativeQuery(anyString())).willReturn(userLockQuery);
		given(userLockQuery.setParameter("userId", userId)).willReturn(userLockQuery);
		given(userLockQuery.getSingleResult()).willReturn(userId);
		given(repository.findRecordingByUserId(userId)).willReturn(List.of());
		given(repository.sumReadyFileSizeBytes(userId)).willReturn(0L);
		given(storage.createMultipartUpload(anyString())).willReturn(uploadId);
		given(storage.presignPartUrl(anyString(), eq(uploadId), eq(1))).willReturn(firstPartUrl);
		willAnswer(invocation -> {
			Video video = invocation.getArgument(0);
			video.setId(videoId);
			return video;
		}).given(repository).saveAndFlush(any(Video.class));
		willThrow(new RuntimeException("Redis unavailable"))
				.given(sessions).createSession(videoId, uploadId, userId, 5_242_880L);

		VideoService service = new VideoService(
				repository,
				storage,
				sessions,
				properties,
				entityManager,
				lock,
				mock(VideoMediaValidator.class),
				cleanup);

		assertThatThrownBy(() -> service.initiateUpload(userId,
				new CreateVideoRequest("VID-017", 5_242_880L, 5_242_880L, "mp4")))
				.isInstanceOf(VideoStorageException.class)
				.hasMessage("Không thể khởi tạo phiên upload");

		verify(storage).abortMultipartUpload(anyString(), eq(uploadId));

		willThrow(new RuntimeException("MinIO unavailable"))
				.given(storage).abortMultipartUpload(anyString(), eq(uploadId));
		assertThatThrownBy(() -> service.initiateUpload(userId,
				new CreateVideoRequest("VID-017 retry", 5_242_880L, 5_242_880L, "mp4")))
				.isInstanceOf(VideoStorageException.class);
		verify(storage, times(2)).abortMultipartUpload(anyString(), eq(uploadId));
		verify(cleanup).recordAbortCleanupJob(isNull(), anyString(), eq(uploadId), any(Instant.class));
	}
}
