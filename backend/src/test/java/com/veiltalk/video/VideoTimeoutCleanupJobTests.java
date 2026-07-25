package com.veiltalk.video;

import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class VideoTimeoutCleanupJobTests {

	@Test
	void timeoutMarksFailedRemovesObjectAndNeverAbortsMultipart() {
		Instant now = Instant.parse("2026-07-26T10:00:00Z");
		VideoRepository repository = Mockito.mock(VideoRepository.class);
		VideoMultipartStorage storage = Mockito.mock(VideoMultipartStorage.class);
		VideoUploadSessionStore sessions = Mockito.mock(VideoUploadSessionStore.class);
		VideoProperties properties = new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300);
		Video video = new Video();
		video.setId(UUID.randomUUID());
		video.setStoragePath("videos/timeout/source.mp4");
		video.setStatus(VideoStatus.PROCESSING);
		given(repository.findTimedOutProcessing(now.minusSeconds(600))).willReturn(List.of(video));
		given(repository.failProcessing(video.getId())).willReturn(1);

		VideoTimeoutCleanupJob job = new VideoTimeoutCleanupJob(
				repository, storage, sessions, properties,
				Clock.fixed(now, ZoneOffset.UTC));
		job.runCleanup();

		verify(repository).failProcessing(video.getId());
		verify(storage).removeObject(video.getStoragePath());
		verify(storage, never()).abortMultipartUpload(Mockito.anyString(), Mockito.anyString());
		verify(sessions).deleteSession(video.getId());
	}
}
