package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserRole;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@TestPropertySource(properties = "minio.webhook.secret=webhook-test-secret")
class VideoWebhookIntegrationTests {

	private static final String AUTHORIZATION = "Bearer webhook-test-secret";
	private static final String EVENT = "s3:ObjectCreated:CompleteMultipartUpload";
	private static final long FILE_SIZE = 10_485_760L;

	@Autowired
	private MockMvc mockMvc;
	@Autowired
	private UserRepository userRepository;
	@Autowired
	private VideoRepository videoRepository;
	@MockitoSpyBean
	private JwtService jwtService;

	private User user;

	@BeforeEach
	void setUp() {
		user = new User();
		user.setEmail("webhook-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName("Webhook test user");
		user.setRole(UserRole.USER);
		user = userRepository.saveAndFlush(user);
	}

	@Test
	void tc31ValidWebhookMarksProcessingVideoReadyAndDecodesKeyOnce() throws Exception {
		Video video = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);

		performWebhook(AUTHORIZATION, payload(record(
				EVENT, "veiltalk", encodeKey(video.getStoragePath()), FILE_SIZE)))
				.andExpect(status().isNoContent())
				.andExpect(content().string(""));

		Video updated = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updated.getStatus()).isEqualTo(VideoStatus.READY);
		assertThat(updated.getFileSizeBytes()).isEqualTo(FILE_SIZE);
		verifyNoInteractions(jwtService);
	}

	@Test
	void tc44RejectsEveryMissingOrMismatchedAuthorizationForm() throws Exception {
		String body = payload(record(EVENT, "veiltalk", "videos%2Funknown%2Fsource.mp4", FILE_SIZE));
		List<String> invalidHeaders = List.of(
				"Bearer wrong-secret",
				"webhook-test-secret",
				"VeilTalkWebhook webhook-test-secret",
				"Bearer",
				"Bearer webhook-test-secretxyz");

		performWebhook(null, body)
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
		for (String invalidHeader : invalidHeaders) {
			performWebhook(invalidHeader, body)
					.andExpect(status().isUnauthorized())
					.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
					.andExpect(content().string(org.hamcrest.Matchers.not(
							org.hamcrest.Matchers.containsString("webhook-test-secret"))));
		}
	}

	@Test
	void validJwtBearerIsNotAcceptedAsWebhookSecret() throws Exception {
		String jwt = jwtService.generateAccessToken(user.getId(), user.getRole());
		performWebhook("Bearer " + jwt,
				payload(record(EVENT, "veiltalk", "videos%2Funknown%2Fsource.mp4", FILE_SIZE)))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void malformedJsonAndStructurallyInvalidRecordsReturn400WithoutPartialUpdate() throws Exception {
		Video video = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);

		performWebhook(AUTHORIZATION, "{")
				.andExpect(status().isBadRequest());

		String valid = record(EVENT, "veiltalk", encodeKey(video.getStoragePath()), FILE_SIZE);
		String invalid = "{\"eventName\":\"" + EVENT
				+ "\",\"s3\":{\"bucket\":{\"name\":\"veiltalk\"},"
				+ "\"object\":{\"key\":\"videos%2Finvalid.mp4\"}}}";
		performWebhook(AUTHORIZATION, payload(valid, invalid))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.PROCESSING);
	}

	@Test
	void processesEveryRecordInBatch() throws Exception {
		Video first = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);
		Video second = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);

		performWebhook(AUTHORIZATION, payload(
				record(EVENT, "veiltalk", encodeKey(first.getStoragePath()), FILE_SIZE),
				record(EVENT, "veiltalk", encodeKey(second.getStoragePath()), FILE_SIZE)))
				.andExpect(status().isNoContent());

		assertThat(videoRepository.findById(first.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.READY);
		assertThat(videoRepository.findById(second.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.READY);
	}

	@Test
	void duplicateTerminalUnknownWrongEventAndWrongBucketAreNoOp204() throws Exception {
		Video ready = seedVideo(VideoStatus.READY, FILE_SIZE, null);
		Video failed = seedVideo(VideoStatus.FAILED, FILE_SIZE, null);
		Video deleted = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, Instant.now());
		Video wrongEvent = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);
		Video wrongBucket = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);

		performWebhook(AUTHORIZATION, payload(
				record(EVENT, "veiltalk", encodeKey(ready.getStoragePath()), FILE_SIZE + 1),
				record(EVENT, "veiltalk", encodeKey(failed.getStoragePath()), FILE_SIZE),
				record(EVENT, "veiltalk", encodeKey(deleted.getStoragePath()), FILE_SIZE),
				record("s3:ObjectCreated:Put", "veiltalk", encodeKey(wrongEvent.getStoragePath()), FILE_SIZE),
				record(EVENT, "other-bucket", encodeKey(wrongBucket.getStoragePath()), FILE_SIZE),
				record(EVENT, "veiltalk", "videos%2Funknown%2Fsource.mp4", FILE_SIZE)))
				.andExpect(status().isNoContent());

		assertThat(videoRepository.findById(ready.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.READY);
		assertThat(videoRepository.findById(failed.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.FAILED);
		assertThat(videoRepository.findById(deleted.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.PROCESSING);
		assertThat(videoRepository.findById(wrongEvent.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.PROCESSING);
		assertThat(videoRepository.findById(wrongBucket.getId()).orElseThrow().getStatus())
				.isEqualTo(VideoStatus.PROCESSING);
	}

	@Test
	void processingSizeMismatchRemainsProcessing() throws Exception {
		Video video = seedVideo(VideoStatus.PROCESSING, FILE_SIZE, null);

		performWebhook(AUTHORIZATION, payload(
				record(EVENT, "veiltalk", encodeKey(video.getStoragePath()), FILE_SIZE + 1)))
				.andExpect(status().isNoContent());

		Video unchanged = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(unchanged.getStatus()).isEqualTo(VideoStatus.PROCESSING);
		assertThat(unchanged.getFileSizeBytes()).isEqualTo(FILE_SIZE);
	}

	private org.springframework.test.web.servlet.ResultActions performWebhook(
			String authorization, String body) throws Exception {
		var request = post("/internal/videos/webhook")
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
		if (authorization != null) {
			request.header("Authorization", authorization);
		}
		return mockMvc.perform(request);
	}

	private Video seedVideo(VideoStatus status, long bytes, Instant deletedAt) {
		Video video = new Video();
		video.setUserId(user.getId());
		video.setTitle("P2-T23");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(bytes);
		video.setFormat("mp4");
		video.setStatus(status);
		video.setDeletedAt(deletedAt);
		return videoRepository.saveAndFlush(video);
	}

	private String payload(String... records) {
		return "{\"EventName\":\"" + EVENT + "\",\"Records\":["
				+ String.join(",", records) + "]}";
	}

	private String record(String event, String bucket, String key, long size) {
		return "{\"eventName\":\"" + event + "\",\"s3\":{"
				+ "\"bucket\":{\"name\":\"" + bucket + "\"},"
				+ "\"object\":{\"key\":\"" + key + "\",\"size\":" + size + "}}}";
	}

	private String encodeKey(String storagePath) {
		return storagePath.replace("/", "%2F");
	}
}
