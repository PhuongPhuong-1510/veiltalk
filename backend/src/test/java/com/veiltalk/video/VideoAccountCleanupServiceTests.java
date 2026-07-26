package com.veiltalk.video;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/**
 * P2-T24 — TC-37: DELETE /users/me phải abort mọi video 'recording' của user. Test ở tầng
 * service (mock toàn bộ collaborator) để không phụ thuộc REQUIRES_NEW/transaction thật —
 * hành vi transaction (không rollback soft-delete tài khoản) được xác nhận thêm ở
 * integration test {@code UserAccountDeletionVideoCleanupIntegrationTests}.
 */
class VideoAccountCleanupServiceTests {

	private static final Instant NOW = Instant.parse("2026-07-26T10:00:00Z");
	private static final UUID USER_ID = UUID.randomUUID();

	@Test
	void abortSucceedsSoftDeletesVideoAndClearsSession() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle lockHandle = mock(RedisDistributedLock.LockHandle.class);
		VideoCleanupTransactionSupport transactionSupport = mock(VideoCleanupTransactionSupport.class);

		Video video = recordingVideo("upload-1");
		given(repository.findRecordingByUserId(USER_ID)).willReturn(List.of(video));
		given(lock.acquire("video:operation-lock:" + video.getId())).willReturn(lockHandle);

		VideoAccountCleanupService service = new VideoAccountCleanupService(
				repository, storage, sessions, lock, transactionSupport, fixedClock());
		service.abortAllRecordingsForUser(USER_ID);

		verify(storage).abortMultipartUpload(video.getStoragePath(), "upload-1");
		verify(transactionSupport).softDeleteRecording(video.getId(), NOW);
		verify(transactionSupport, never()).recordAbortCleanupJob(
				any(), any(), any(), any());
		verify(sessions).deleteSession(video.getId());
	}

	@Test
	void abortFailureDoesNotSoftDeleteButRecordsRetryableCleanupJob() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle lockHandle = mock(RedisDistributedLock.LockHandle.class);
		VideoCleanupTransactionSupport transactionSupport = mock(VideoCleanupTransactionSupport.class);

		Video video = recordingVideo("upload-2");
		given(repository.findRecordingByUserId(USER_ID)).willReturn(List.of(video));
		given(lock.acquire("video:operation-lock:" + video.getId())).willReturn(lockHandle);
		willThrow(new VideoStorageException("MinIO unavailable", new RuntimeException()))
				.given(storage).abortMultipartUpload(video.getStoragePath(), "upload-2");

		VideoAccountCleanupService service = new VideoAccountCleanupService(
				repository, storage, sessions, lock, transactionSupport, fixedClock());
		service.abortAllRecordingsForUser(USER_ID);

		// Không rollback: soft-delete KHÔNG được gọi khi MinIO abort lỗi — video giữ 'recording'
		// (khớp hành vi POST /videos/{id}/abort), và một cleanup job bền vững được ghi để retry.
		verify(transactionSupport, never()).softDeleteRecording(any(), any());
		verify(transactionSupport).recordAbortCleanupJob(
				video.getId(), video.getStoragePath(), "upload-2", NOW);
		verify(sessions, never()).deleteSession(any());
	}

	@Test
	void unknownUploadIdFallsBackToSoftDeleteWithoutMinioCallOrCleanupJob() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		VideoCleanupTransactionSupport transactionSupport = mock(VideoCleanupTransactionSupport.class);

		// upload_id NULL trong DB (video tạo trước migration V3) và Redis session cũng hết hạn.
		Video video = recordingVideo(null);
		given(repository.findRecordingByUserId(USER_ID)).willReturn(List.of(video));
		given(sessions.findSession(video.getId())).willReturn(Optional.empty());

		VideoAccountCleanupService service = new VideoAccountCleanupService(
				repository, storage, sessions, lock, transactionSupport, fixedClock());
		service.abortAllRecordingsForUser(USER_ID);

		verify(storage, never()).abortMultipartUpload(any(), any());
		verify(lock, never()).acquire(any());
		verify(transactionSupport).softDeleteRecording(video.getId(), NOW);
		verify(transactionSupport, never()).recordAbortCleanupJob(
				any(), any(), any(), any());
	}

	@Test
	void unknownDbUploadIdFallsBackToRedisSession() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle lockHandle = mock(RedisDistributedLock.LockHandle.class);
		VideoCleanupTransactionSupport transactionSupport = mock(VideoCleanupTransactionSupport.class);

		Video video = recordingVideo(null);
		given(repository.findRecordingByUserId(USER_ID)).willReturn(List.of(video));
		given(sessions.findSession(video.getId())).willReturn(Optional.of(
				new VideoUploadSessionStore.UploadSession(
						"redis-upload-id", USER_ID, 5_242_880L, 2, java.util.Map.of())));
		given(lock.acquire("video:operation-lock:" + video.getId())).willReturn(lockHandle);

		VideoAccountCleanupService service = new VideoAccountCleanupService(
				repository, storage, sessions, lock, transactionSupport, fixedClock());
		service.abortAllRecordingsForUser(USER_ID);

		verify(storage).abortMultipartUpload(video.getStoragePath(), "redis-upload-id");
		verify(transactionSupport).softDeleteRecording(video.getId(), NOW);
	}

	@Test
	void oneVideoFailureDoesNotStopProcessingOthers() {
		VideoRepository repository = mock(VideoRepository.class);
		VideoMultipartStorage storage = mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle lockHandle = mock(RedisDistributedLock.LockHandle.class);
		VideoCleanupTransactionSupport transactionSupport = mock(VideoCleanupTransactionSupport.class);

		Video failing = recordingVideo("upload-fail");
		Video succeeding = recordingVideo("upload-ok");
		given(repository.findRecordingByUserId(USER_ID)).willReturn(List.of(failing, succeeding));
		given(lock.acquire(eq("video:operation-lock:" + failing.getId()))).willReturn(lockHandle);
		given(lock.acquire(eq("video:operation-lock:" + succeeding.getId()))).willReturn(lockHandle);
		willThrow(new VideoStorageException("MinIO unavailable", new RuntimeException()))
				.given(storage).abortMultipartUpload(failing.getStoragePath(), "upload-fail");

		VideoAccountCleanupService service = new VideoAccountCleanupService(
				repository, storage, sessions, lock, transactionSupport, fixedClock());
		service.abortAllRecordingsForUser(USER_ID);

		verify(transactionSupport).recordAbortCleanupJob(
				failing.getId(), failing.getStoragePath(), "upload-fail", NOW);
		verify(transactionSupport).softDeleteRecording(succeeding.getId(), NOW);
	}

	private Video recordingVideo(String uploadId) {
		Video video = new Video();
		video.setId(UUID.randomUUID());
		video.setUserId(USER_ID);
		video.setStoragePath("videos/" + video.getId() + "/source.mp4");
		video.setStatus(VideoStatus.RECORDING);
		video.setFileSizeBytes(10_485_760L);
		video.setUploadId(uploadId);
		return video;
	}

	private Clock fixedClock() {
		return Clock.fixed(NOW, ZoneOffset.UTC);
	}
}
