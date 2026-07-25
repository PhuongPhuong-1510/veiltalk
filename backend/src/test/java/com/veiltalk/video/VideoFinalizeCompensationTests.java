package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import jakarta.persistence.EntityManager;

class VideoFinalizeCompensationTests {

	@Test
	void completeSuccessAndDatabaseFailureRemovesObjectAndDeletesFinishedSession() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		VideoProperties properties = new VideoProperties(
				Long.MAX_VALUE, 21_600, 3_600, 30_000, 5_000, 600, 300);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle quotaHandle = mock(RedisDistributedLock.LockHandle.class);
		RedisDistributedLock.LockHandle videoHandle = mock(RedisDistributedLock.LockHandle.class);
		EntityManager entityManager = mock(EntityManager.class);
		UUID userId = UUID.randomUUID();
		UUID videoId = UUID.randomUUID();
		String objectKey = "videos/compensation/source.mp4";
		Video video = new Video();
		video.setId(videoId);
		video.setUserId(userId);
		video.setStoragePath(objectKey);
		video.setStatus(VideoStatus.RECORDING);
		video.setFileSizeBytes(10);
		var requestParts = List.of(
				new FinalizeVideoRequest.PartRequest(1, "etag-1"),
				new FinalizeVideoRequest.PartRequest(2, "etag-2"));
		var actualParts = List.of(
				new VideoMultipartStorage.UploadedPart(1, "etag-1", 5),
				new VideoMultipartStorage.UploadedPart(2, "etag-2", 5));

		given(lock.acquire(anyString())).willReturn(quotaHandle, videoHandle);
		given(repository.findById(videoId)).willReturn(Optional.of(video));
		given(repository.sumQuotaReservedBytes(userId)).willReturn(0L);
		given(repository.markProcessing(videoId, 12, 10L))
				.willThrow(new IllegalStateException("database unavailable"));
		given(sessions.findSession(videoId)).willReturn(Optional.of(
				new VideoUploadSessionStore.UploadSession(
						"upload-id", userId, 5, 3, Map.of(1, "etag-1"))));
		given(storage.listParts(objectKey, "upload-id")).willReturn(actualParts);

		VideoService service = new VideoService(
				repository, storage, sessions, properties, entityManager, lock);

		assertThatThrownBy(() -> service.finalizeUpload(userId, videoId,
				new FinalizeVideoRequest("upload-id", requestParts, 12)))
				.isInstanceOf(IllegalStateException.class);

		verify(storage).completeMultipartUpload(objectKey, "upload-id", actualParts);
		verify(storage).removeObject(objectKey);
		verify(sessions).deleteSession(videoId);
	}
}
