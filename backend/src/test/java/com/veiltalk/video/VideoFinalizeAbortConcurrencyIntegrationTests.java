package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
class VideoFinalizeAbortConcurrencyIntegrationTests {

	@Autowired
	private VideoService videoService;
	@Autowired
	private VideoRepository videoRepository;
	@Autowired
	private VideoUploadSessionStore sessionStore;
	@Autowired
	private UserRepository userRepository;
	@Autowired
	private StringRedisTemplate redisTemplate;

	@MockitoBean
	private VideoMultipartStorage storage;

	private UUID videoId;
	private UUID userId;

	@AfterEach
	void tearDown() {
		if (videoId != null) {
			redisTemplate.delete("video:upload:" + videoId);
			redisTemplate.delete("video:operation-lock:" + videoId);
			videoRepository.deleteById(videoId);
		}
		if (userId != null) {
			redisTemplate.delete("video:quota-lock:" + userId);
			userRepository.deleteById(userId);
		}
	}

	@Test
	void finalizeAndAbortRaceOnlyOneCanWin() throws Exception {
		User user = new User();
		user.setEmail("race-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName("race");
		user = userRepository.saveAndFlush(user);
		userId = user.getId();

		Video video = new Video();
		video.setUserId(userId);
		video.setTitle("race");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(10);
		video.setStatus(VideoStatus.RECORDING);
		video.setFormat("mp4");
		video = videoRepository.saveAndFlush(video);
		videoId = video.getId();
		sessionStore.createSession(videoId, "upload-race", userId, 5);
		sessionStore.reserveNextPart(videoId, "upload-race", 2, "etag-1", 0, Long.MAX_VALUE);

		var actualParts = List.of(
				new VideoMultipartStorage.UploadedPart(1, "etag-1", 5),
				new VideoMultipartStorage.UploadedPart(2, "etag-2", 5));
		given(storage.listParts(video.getStoragePath(), "upload-race")).willReturn(actualParts);
		FinalizeVideoRequest finalizeRequest = new FinalizeVideoRequest(
				"upload-race",
				List.of(
						new FinalizeVideoRequest.PartRequest(1, "etag-1"),
						new FinalizeVideoRequest.PartRequest(2, "etag-2")),
				12);
		AbortVideoRequest abortRequest = new AbortVideoRequest("upload-race");

		CountDownLatch start = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			UUID capturedUserId = userId;
			UUID capturedVideoId = videoId;
			Future<Boolean> finalizeResult = executor.submit(() -> {
				start.await();
				try {
					videoService.finalizeUpload(capturedUserId, capturedVideoId, finalizeRequest);
					return true;
				} catch (RuntimeException exception) {
					return false;
				}
			});
			Future<Boolean> abortResult = executor.submit(() -> {
				start.await();
				try {
					videoService.abortUpload(capturedUserId, capturedVideoId, abortRequest);
					return true;
				} catch (RuntimeException exception) {
					return false;
				}
			});
			start.countDown();

			assertThat(List.of(finalizeResult.get(), abortResult.get()))
					.containsExactlyInAnyOrder(true, false);
		} finally {
			executor.shutdownNow();
		}
	}
}
