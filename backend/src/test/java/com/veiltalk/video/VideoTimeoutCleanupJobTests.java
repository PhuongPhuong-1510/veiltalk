package com.veiltalk.video;

import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class VideoTimeoutCleanupJobTests {

	@Test
	void timeoutWithoutCompletedObjectMarksFailedWithoutRemoveObject() {
		Fixture fixture = fixture("videos/timeout/source.mp4");
		given(fixture.storage.statObjectSize(fixture.video.getStoragePath()))
				.willReturn(OptionalLong.empty());
		given(fixture.repository.failProcessing(fixture.video.getId())).willReturn(1);

		fixture.job.runCleanup();

		verify(fixture.repository).failProcessing(fixture.video.getId());
		verify(fixture.storage, never()).removeObject(fixture.video.getStoragePath());
		verify(fixture.storage, never()).abortMultipartUpload(
				Mockito.anyString(), Mockito.anyString());
		verify(fixture.sessions).deleteSession(fixture.video.getId());
	}

	@Test
	void timeoutWithCompletedObjectMarksReadyAndNeverFailsOrRemoves() {
		Fixture fixture = fixture("videos/timeout-ready/source.mp4");
		given(fixture.storage.statObjectSize(fixture.video.getStoragePath()))
				.willReturn(OptionalLong.of(10L));

		fixture.job.runCleanup();

		verify(fixture.repository).markReadyFromWebhook(
				fixture.video.getStoragePath(), 10L);
		verify(fixture.repository, never()).failProcessing(fixture.video.getId());
		verify(fixture.storage, never()).removeObject(fixture.video.getStoragePath());
		verify(fixture.sessions).deleteSession(fixture.video.getId());
	}

	@Test
	void timeoutCannotReachMinioKeepsProcessing() {
		Fixture fixture = fixture("videos/timeout-unknown/source.mp4");
		given(fixture.storage.statObjectSize(fixture.video.getStoragePath()))
				.willThrow(new VideoStorageException(
						"MinIO unavailable", new RuntimeException("connection failed")));

		fixture.job.runCleanup();

		verify(fixture.repository, never()).failProcessing(fixture.video.getId());
		verify(fixture.storage, never()).removeObject(fixture.video.getStoragePath());
		verify(fixture.sessions, never()).deleteSession(fixture.video.getId());
	}

	private Fixture fixture(String storagePath) {
		Instant now = Instant.parse("2026-07-26T10:00:00Z");
		VideoRepository repository = Mockito.mock(VideoRepository.class);
		VideoMultipartStorage storage = Mockito.mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = Mockito.mock(VideoUploadSessionStore.class);
		RedisDistributedLock lock = Mockito.mock(RedisDistributedLock.class);
		RedisDistributedLock.LockHandle lockHandle = Mockito.mock(
				RedisDistributedLock.LockHandle.class);
		VideoProperties properties = new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300);
		Video video = new Video();
		video.setId(UUID.randomUUID());
		video.setStoragePath(storagePath);
		video.setStatus(VideoStatus.PROCESSING);
		video.setFileSizeBytes(10L);
		given(repository.findTimedOutProcessing(now.minusSeconds(600)))
				.willReturn(List.of(video));
		given(lock.acquire("video:operation-lock:" + video.getId())).willReturn(lockHandle);
		VideoTimeoutCleanupJob job = new VideoTimeoutCleanupJob(
				repository, storage, sessions, properties, lock,
				Clock.fixed(now, ZoneOffset.UTC));
		return new Fixture(repository, storage, sessions, video, job);
	}

	private record Fixture(
			VideoRepository repository,
			VideoMultipartStorage storage,
			VideoUploadSessionStore sessions,
			Video video,
			VideoTimeoutCleanupJob job) {
	}
}
