package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashSet;
import java.util.List;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class VideoFinalizeAbortIntegrationTests {

	private static final String UPLOAD_ID = "upload-t22";
	private static final long PART_SIZE = 5_242_880L;

	@Autowired
	private MockMvc mockMvc;
	@Autowired
	private UserRepository userRepository;
	@Autowired
	private VideoRepository videoRepository;
	@Autowired
	private VideoUploadSessionStore sessionStore;
	@Autowired
	private StringRedisTemplate redisTemplate;
	@Autowired
	private JwtService jwtService;
	@Autowired
	private VideoWebhookService videoWebhookService;

	@MockitoBean
	private VideoMultipartStorage multipartStorage;

	private final Set<UUID> redisVideoIds = new HashSet<>();
	private User user;
	private String token;

	@BeforeEach
	void setUp() {
		user = createUser();
		token = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@AfterEach
	void tearDown() {
		redisVideoIds.forEach(id -> {
			redisTemplate.delete("video:upload:" + id);
			redisTemplate.delete("video:operation-lock:" + id);
		});
		redisTemplate.delete("video:quota-lock:" + user.getId());
	}

	@Test
	void tc31FinalizesAndStoresActualSize() throws Exception {
		Video video = recordingWithTwoParts("etag-1");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID))
				.willReturn(minioParts("etag-1", "\"etag-2\""));

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isAccepted())
				.andExpect(jsonPath("$.id").value(video.getId().toString()))
				.andExpect(jsonPath("$.status").value("processing"));

		Video updated = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updated.getStatus()).isEqualTo(VideoStatus.PROCESSING);
		assertThat(updated.getDurationSecs()).isEqualTo(12);
		assertThat(updated.getFileSizeBytes()).isEqualTo(PART_SIZE * 2);
		assertThat(sessionStore.findSession(video.getId())).isEmpty();
		verify(multipartStorage).completeMultipartUpload(
				video.getStoragePath(), UPLOAD_ID, minioParts("etag-1", "\"etag-2\""));
	}

	@Test
	void webhookArrivingDuringMinioCompleteMustNotBeLostBeforeProcessingTransition() throws Exception {
		Video video = recordingWithTwoParts("etag-1");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID))
				.willReturn(minioParts("etag-1", "etag-2"));
		doAnswer(invocation -> {
			videoWebhookService.process(new VideoWebhookRequest(List.of(
					new VideoWebhookRequest.NotificationRecord(
							"s3:ObjectCreated:CompleteMultipartUpload",
							new VideoWebhookRequest.S3Data(
									new VideoWebhookRequest.BucketData("veiltalk"),
									new VideoWebhookRequest.ObjectData(
											video.getStoragePath().replace("/", "%2F"),
											PART_SIZE * 2))))));
			return null;
		}).when(multipartStorage).completeMultipartUpload(
				video.getStoragePath(), UPLOAD_ID, minioParts("etag-1", "etag-2"));

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isAccepted());

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getStatus())
				.as("Webhook CompleteMultipartUpload đến trong lúc complete không được bị ACK mất")
				.isEqualTo(VideoStatus.READY);
	}

	@Test
	void completeResponseLostButObjectExistsReconcilesReady() throws Exception {
		Video video = recordingWithTwoParts("etag-1");
		var parts = minioParts("etag-1", "etag-2");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID)).willReturn(parts);
		willThrow(new VideoStorageException("response lost", new RuntimeException("timeout")))
				.given(multipartStorage).completeMultipartUpload(
						video.getStoragePath(), UPLOAD_ID, parts);
		given(multipartStorage.statObjectSize(video.getStoragePath()))
				.willReturn(OptionalLong.of(PART_SIZE * 2));

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isAccepted());

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.READY);
		assertThat(sessionStore.findSession(video.getId())).isEmpty();
	}

	@Test
	void completeFailsAndMultipartStillExistsRestoresRecording() throws Exception {
		Video video = recordingWithTwoParts("etag-1");
		var parts = minioParts("etag-1", "etag-2");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID)).willReturn(parts);
		willThrow(new VideoStorageException("complete failed", new RuntimeException("MinIO error")))
				.given(multipartStorage).completeMultipartUpload(
						video.getStoragePath(), UPLOAD_ID, parts);
		given(multipartStorage.statObjectSize(video.getStoragePath()))
				.willReturn(OptionalLong.empty());

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isInternalServerError());

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.RECORDING);
		assertThat(sessionStore.findSession(video.getId())).isPresent();
	}

	@Test
	void tc32AbortsAndSoftDeletes() throws Exception {
		Video video = recordingWithSession();

		mockMvc.perform(post("/videos/" + video.getId() + "/abort")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"upload_id\":\"" + UPLOAD_ID + "\"}"))
				.andExpect(status().isNoContent());

		Video updated = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updated.getStatus()).isEqualTo(VideoStatus.FAILED);
		assertThat(updated.getDeletedAt()).isNotNull();
		assertThat(sessionStore.findSession(video.getId())).isEmpty();
		verify(multipartStorage).abortMultipartUpload(video.getStoragePath(), UPLOAD_ID);
	}

	@Test
	void actualQuotaExceededAbortsAndSoftDeletes() throws Exception {
		seedVideo(VideoStatus.READY, 2_140_000_000L);
		Video video = recordingWithTwoParts("etag-1");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID))
				.willReturn(minioParts("etag-1", "etag-2"));

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isInsufficientStorage())
				.andExpect(jsonPath("$.error.code").value("STORAGE_QUOTA_EXCEEDED"));

		Video updated = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updated.getStatus()).isEqualTo(VideoStatus.FAILED);
		assertThat(updated.getDeletedAt()).isNotNull();
		verify(multipartStorage).abortMultipartUpload(video.getStoragePath(), UPLOAD_ID);
		verify(multipartStorage, never()).completeMultipartUpload(anyString(), anyString(), anyList());
	}

	@Test
	void requestEtagDifferentFromRedisReturns400BeforeMinio() throws Exception {
		Video video = recordingWithTwoParts("redis-etag");

		mockMvc.perform(finalizeRequest(video.getId(), "request-etag", "etag-2"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		verify(multipartStorage, never()).listParts(anyString(), anyString());
	}

	@Test
	void requestAndRedisEtagDifferentFromMinioReturns400() throws Exception {
		Video video = recordingWithTwoParts("etag-1");
		given(multipartStorage.listParts(video.getStoragePath(), UPLOAD_ID))
				.willReturn(minioParts("different-minio-etag", "etag-2"));

		mockMvc.perform(finalizeRequest(video.getId(), "etag-1", "etag-2"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		verify(multipartStorage, never()).completeMultipartUpload(anyString(), anyString(), anyList());
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder finalizeRequest(
			UUID videoId, String etag1, String etag2) {
		return post("/videos/" + videoId + "/finalize")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"upload_id\":\"" + UPLOAD_ID + "\",\"parts\":["
						+ "{\"part_number\":1,\"etag\":\"" + etag1 + "\"},"
						+ "{\"part_number\":2,\"etag\":\"" + etag2 + "\"}],"
						+ "\"duration_secs\":12}");
	}

	private Video recordingWithTwoParts(String firstEtag) {
		Video video = recordingWithSession();
		sessionStore.reserveNextPart(video.getId(), UPLOAD_ID, 2, firstEtag, 0,
				Long.MAX_VALUE);
		return video;
	}

	private Video recordingWithSession() {
		Video video = seedVideo(VideoStatus.RECORDING, PART_SIZE * 2);
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), PART_SIZE);
		redisVideoIds.add(video.getId());
		return video;
	}

	private List<VideoMultipartStorage.UploadedPart> minioParts(String etag1, String etag2) {
		return List.of(
				new VideoMultipartStorage.UploadedPart(1, etag1, PART_SIZE),
				new VideoMultipartStorage.UploadedPart(2, etag2, PART_SIZE));
	}

	private Video seedVideo(VideoStatus status, long bytes) {
		Video video = new Video();
		video.setUserId(user.getId());
		video.setTitle("P2-T22");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(bytes);
		video.setFormat("mp4");
		video.setStatus(status);
		return videoRepository.saveAndFlush(video);
	}

	private User createUser() {
		User newUser = new User();
		newUser.setEmail("t22-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("test-only-hash");
		newUser.setDisplayName("P2-T22 user");
		return userRepository.saveAndFlush(newUser);
	}
}
